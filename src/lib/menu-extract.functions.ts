import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ExtractInput = {
  filename: string;
  mimeType: string;
  // base64 data WITHOUT the data: prefix
  base64: string;
};

type ExtractedItem = {
  category?: string | null;
  name: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
};

const SYSTEM_PROMPT = `Você é um especialista em extrair dados estruturados de cardápios de restaurantes a partir de imagens, PDFs ou texto.
Sua tarefa: identificar TODOS os itens do cardápio fornecido e devolver SOMENTE um JSON válido (sem markdown, sem comentários).

Formato exato:
{
  "currency": "BRL",
  "items": [
    {
      "category": "string ou null (ex: Entradas, Pratos Principais, Bebidas, Sobremesas)",
      "name": "nome do item",
      "description": "descrição/ingredientes ou null se não houver",
      "price": número decimal (ex: 29.90) ou null se não houver preço claro
    }
  ]
}

Regras:
- Preços brasileiros: "R$ 29,90" -> 29.90
- Não invente itens. Se ilegível, retorne items: [].
- Categorize cada item usando a seção/título visível no cardápio.
- Devolva APENAS o JSON, nada mais.`;

export const extractMenu = createServerFn({ method: "POST" })
  .inputValidator((d: ExtractInput) => d)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY ausente");

    // 1) Create upload row
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
      // 2) Build multimodal message. Gemini via Lovable AI Gateway accepts image_url with data URLs.
      const isText = data.mimeType.startsWith("application/json") || data.mimeType.startsWith("text/");
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
        // try to find first {...}
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (!m) throw new Error("Resposta da IA não é JSON válido");
        parsed = JSON.parse(m[0]);
      }

      const currency = parsed.currency || "BRL";
      const items = Array.isArray(parsed.items) ? parsed.items : [];

      if (items.length > 0) {
        const rows = items.map((it) => ({
          upload_id: upload.id,
          category: it.category ?? null,
          name: it.name,
          description: it.description ?? null,
          price: typeof it.price === "number" ? it.price : null,
          currency: it.currency ?? currency,
        }));
        const { error: insErr } = await supabaseAdmin.from("menu_items").insert(rows);
        if (insErr) throw new Error(insErr.message);
      }

      await supabaseAdmin
        .from("menu_uploads")
        .update({ status: "done", raw_response: parsed as any })
        .eq("id", upload.id);

      return { uploadId: upload.id, count: items.length };
    } catch (e: any) {
      await supabaseAdmin
        .from("menu_uploads")
        .update({ status: "error", error: String(e?.message || e) })
        .eq("id", upload.id);
      throw e;
    }
  });
