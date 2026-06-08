import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ExtractInput = {
  filename: string;
  mimeType: string;
  // base64 data WITHOUT the data: prefix
  base64: string;
  deviceId: string;
};

function validateDeviceId(id: unknown): string {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    throw new Error("deviceId inválido");
  }
  return id;
}

type ExtractedItem = {
  category?: string | null;
  name?: string | null;
  description?: string | null;
  price?: number | string | null;
  currency?: string | null;
  attributes?: string[] | string | null;
};

const SYSTEM_PROMPT = `Você é um especialista em extrair dados estruturados de cardápios de restaurantes a partir de imagens, PDFs ou texto.
Sua tarefa: identificar APENAS os itens efetivamente visíveis e legíveis no cardápio fornecido e devolver SOMENTE um JSON válido (sem markdown, sem comentários).

Formato exato:
{
  "currency": "BRL",
  "items": [
    {
      "category": "string (ex: Entradas, Pratos Principais, Bebidas, Sobremesas) ou null",
      "name": "nome do item",
      "description": "ingredientes/detalhes ou null se não houver",
      "price": número decimal (ex: 29.90) ou null se não houver preço claro,
      "attributes": ["lista curta de atributos extras"]
    }
  ]
}

REGRAS DE FIDELIDADE (CRÍTICO — não viole nunca):
- NÃO invente itens, categorias, descrições, preços ou atributos. Não complete o que não está no cardápio.
- Não use conhecimento prévio sobre restaurantes ou pratos típicos para "preencher" informações ausentes.
- Se um campo não estiver visível ou legível, use null (ou [] para attributes). Nunca chute.
- Se o preço estiver ilegível, parcialmente cortado ou ambíguo, use price: null (não estime).
- Se o nome do item estiver ilegível, NÃO inclua o item — descarte.
- Se o cardápio inteiro estiver ilegível ou não for um cardápio, devolva { "currency": "BRL", "items": [] }.
- Preços brasileiros: "R$ 29,90" -> 29.90. Mantenha o valor exatamente como aparece.
- Categorize cada item usando a seção/título visível no cardápio; se não houver, use null.
- attributes: apenas o que estiver escrito no cardápio. Nunca deduza.
- Devolva APENAS o JSON, nada mais.`;

// ---------- Guardrails (Great Expectations-style) ----------
// Implementadas em TS para rodarem no mesmo runtime, espelhando as regras:
//  - expect_column_values_to_not_be_null: name, price
//  - expect_column_values_to_be_in_type_list: name:string, price:number, category:string|null, description:string|null
//  - expect_column_values_to_be_between: price > 0 (e <= 100000 como sanity)
//  - duplicidades dentro do mesmo upload (mesmo nome+preço normalizado)

type CleanItem = {
  category: string | null;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  attributes: string[] | null;
};

type Rejected = {
  raw: ExtractedItem;
  category: string | null;
  name: string | null;
  description: string | null;
  price: number | null;
  currency: string;
  attributes: string[] | null;
  reasons: string[];
};

function coercePrice(p: unknown): number | null {
  if (typeof p === "number" && Number.isFinite(p)) return p;
  if (typeof p === "string") {
    const cleaned = p.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceAttrs(a: unknown): string[] | null {
  if (Array.isArray(a)) {
    const arr = a.map((x) => String(x).trim()).filter(Boolean);
    return arr.length ? arr : null;
  }
  if (typeof a === "string" && a.trim()) return [a.trim()];
  return null;
}

function runGuardrails(items: ExtractedItem[], defaultCurrency: string) {
  const valid: CleanItem[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();

  for (const raw of items) {
    const reasons: string[] = [];

    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const category =
      typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : null;
    const description =
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : null;
    const price = coercePrice(raw.price);
    const currency =
      typeof raw.currency === "string" && raw.currency.trim()
        ? raw.currency.trim().toUpperCase()
        : defaultCurrency;
    const attributes = coerceAttrs(raw.attributes);

    // not-null
    if (!name) reasons.push("name_null");
    if (price === null) reasons.push("price_null");

    // type / range
    if (price !== null && !(price > 0)) reasons.push("price_not_positive");
    if (price !== null && price > 100000) reasons.push("price_out_of_range");

    // duplicate within upload
    const dupKey = `${name.toLowerCase()}|${price ?? "na"}`;
    if (name && !reasons.length && seen.has(dupKey)) reasons.push("duplicate");

    if (reasons.length === 0 && name && price !== null) {
      seen.add(dupKey);
      valid.push({ category, name, description, price, currency, attributes });
    } else {
      rejected.push({
        raw,
        category,
        name: name || null,
        description,
        price,
        currency,
        attributes,
        reasons,
      });
    }
  }

  return { valid, rejected };
}

export const extractMenu = createServerFn({ method: "POST" })
  .inputValidator((d: ExtractInput) => d)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY ausente");

    const { data: upload, error: upErr } = await supabaseAdmin
      .from("menu_uploads")
      .insert({
        filename: data.filename,
        mime_type: data.mimeType,
        status: "processing",
      })
      .select()
      .single();
    if (upErr || !upload) throw new Error(upErr?.message || "Falha ao criar upload");

    try {
      const isText =
        data.mimeType.startsWith("application/json") || data.mimeType.startsWith("text/");
      const userContent: any[] = [
        { type: "text", text: "Extraia os itens deste cardápio conforme o formato JSON exigido." },
      ];

      if (isText) {
        const text = Buffer.from(data.base64, "base64").toString("utf-8");
        userContent.push({ type: "text", text: `Conteúdo do arquivo:\n\n${text.slice(0, 50000)}` });
      } else {
        userContent.push({
          type: "image_url",
          image_url: { url: `data:${data.mimeType};base64,${data.base64}` },
        });
      }

      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
        }),
      });

      if (!aiRes.ok) {
        const body = await aiRes.text();
        throw new Error(`IA falhou (${aiRes.status}): ${body.slice(0, 500)}`);
      }

      const aiJson: any = await aiRes.json();
      const raw: string = aiJson.choices?.[0]?.message?.content ?? "";
      const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

      let parsed: { currency?: string; items: ExtractedItem[] };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (!m) throw new Error("Resposta da IA não é JSON válido");
        parsed = JSON.parse(m[0]);
      }

      const currency = parsed.currency || "BRL";
      const items = Array.isArray(parsed.items) ? parsed.items : [];

      // ---------- Guardrails ----------
      const { valid, rejected } = runGuardrails(items, currency);

      if (valid.length > 0) {
        const rows = valid.map((it) => ({
          upload_id: upload.id,
          category: it.category,
          name: it.name,
          description: it.description,
          price: it.price,
          currency: it.currency,
          attributes: it.attributes as any,
        }));
        const { error: insErr } = await supabaseAdmin.from("menu_items").insert(rows);
        if (insErr) throw new Error(insErr.message);
      }

      if (rejected.length > 0) {
        const rows = rejected.map((r) => ({
          upload_id: upload.id,
          category: r.category,
          name: r.name,
          description: r.description,
          price: r.price,
          currency: r.currency,
          attributes: r.attributes as any,
          raw: r.raw as any,
          reasons: r.reasons,
        }));
        const { error: revErr } = await supabaseAdmin.from("menu_items_review").insert(rows);
        if (revErr) throw new Error(revErr.message);
      }

      await supabaseAdmin
        .from("menu_uploads")
        .update({ status: "done", raw_response: parsed as any })
        .eq("id", upload.id);

      return {
        uploadId: upload.id,
        count: valid.length,
        rejected: rejected.length,
      };
    } catch (e: any) {
      await supabaseAdmin
        .from("menu_uploads")
        .update({ status: "error", error: String(e?.message || e) })
        .eq("id", upload.id);
      throw e;
    }
  });

export const deleteUpload = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => {
    if (!d?.id || typeof d.id !== "string" || d.id.length > 64) {
      throw new Error("id inválido");
    }
    return d;
  })
  .handler(async ({ data }) => {
    await supabaseAdmin.from("menu_items").delete().eq("upload_id", data.id);
    await supabaseAdmin.from("menu_items_review").delete().eq("upload_id", data.id);
    const { error } = await supabaseAdmin.from("menu_uploads").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listUploads = createServerFn({ method: "GET" })
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("menu_uploads")
      .select("id, filename, status, error, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listItems = createServerFn({ method: "POST" })
  .inputValidator((d: { uploadId: string }) => {
    if (!d?.uploadId || typeof d.uploadId !== "string" || d.uploadId.length > 64) {
      throw new Error("uploadId inválido");
    }
    return d;
  })
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("menu_items")
      .select("id, upload_id, category, name, description, price, currency, attributes, created_at")
      .eq("upload_id", data.uploadId)
      .order("category", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listReview = createServerFn({ method: "POST" })
  .inputValidator((d: { uploadId: string }) => {
    if (!d?.uploadId || typeof d.uploadId !== "string" || d.uploadId.length > 64) {
      throw new Error("uploadId inválido");
    }
    return d;
  })
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("menu_items_review")
      .select("id, upload_id, category, name, description, price, currency, attributes, reasons, created_at")
      .eq("upload_id", data.uploadId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
