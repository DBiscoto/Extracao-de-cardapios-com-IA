import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, Download, Loader2, Sparkles, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import { toast, Toaster } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { extractMenu } from "@/lib/menu-extract.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cardápio → Planilha | Extração com IA" },
      {
        name: "description",
        content:
          "Envie a imagem, PDF ou JSON de um cardápio e receba uma planilha Excel e um banco com itens, descrições e preços extraídos por IA.",
      },
    ],
  }),
  component: Index,
});

type ItemRow = {
  id: string;
  upload_id: string;
  category: string | null;
  name: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  created_at: string;
};

type UploadRow = {
  id: string;
  filename: string;
  status: string;
  error: string | null;
  created_at: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function Index() {
  const qc = useQueryClient();
  const extract = useServerFn(extractMenu);
  const [activeUpload, setActiveUpload] = useState<string | null>(null);

  const uploadsQ = useQuery({
    queryKey: ["uploads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_uploads")
        .select("id, filename, status, error, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as UploadRow[];
    },
    refetchInterval: 4000,
  });

  const itemsQ = useQuery({
    queryKey: ["items", activeUpload],
    enabled: !!activeUpload,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_items")
        .select("*")
        .eq("upload_id", activeUpload!)
        .order("category", { ascending: true });
      if (error) throw error;
      return data as ItemRow[];
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await fileToBase64(file);
      return extract({
        data: { filename: file.name, mimeType: file.type || "application/octet-stream", base64 },
      });
    },
    onSuccess: (res) => {
      toast.success(`Cardápio processado — ${res.count} item(ns) extraídos`);
      setActiveUpload(res.uploadId);
      qc.invalidateQueries({ queryKey: ["uploads"] });
    },
    onError: (e: any) => toast.error(e?.message || "Falha na extração"),
  });

  const removeUpload = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("menu_uploads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, id) => {
      if (activeUpload === id) setActiveUpload(null);
      qc.invalidateQueries({ queryKey: ["uploads"] });
      toast.success("Removido");
    },
  });

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 15 MB)");
      return;
    }
    upload.mutate(f);
    e.target.value = "";
  }

  function exportExcel() {
    const items = itemsQ.data || [];
    if (!items.length) return;
    const rows = items.map((i) => ({
      Categoria: i.category || "",
      Item: i.name,
      Descrição: i.description || "",
      Preço: i.price ?? "",
      Moeda: i.currency || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 22 }, { wch: 32 }, { wch: 50 }, { wch: 10 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cardápio");
    const upload = uploadsQ.data?.find((u) => u.id === activeUpload);
    const name = (upload?.filename || "cardapio").replace(/\.[^.]+$/, "");
    XLSX.writeFile(wb, `${name}.xlsx`);
  }

  const grouped = useMemo(() => {
    const map = new Map<string, ItemRow[]>();
    (itemsQ.data || []).forEach((it) => {
      const k = it.category || "Sem categoria";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    });
    return Array.from(map.entries());
  }, [itemsQ.data]);

  return (
    <div className="min-h-screen">
      <Toaster theme="dark" position="top-right" />

      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <span className="text-sm font-medium tracking-wide">Cardápio · Extrator</span>
          </div>
          <span className="text-xs text-muted-foreground">POC · Gemini multimodal</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12 space-y-10">
        <section className="space-y-3 max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight">
            Cardápio em <span className="text-primary">planilha</span>, em segundos.
          </h1>
          <p className="text-muted-foreground">
            Envie uma imagem, PDF ou JSON. A IA identifica categorias, itens, descrições e preços, salva
            no banco e gera uma planilha Excel pronta para download.
          </p>
        </section>

        <Card className="p-8 bg-card border-border">
          <label className="flex flex-col items-center justify-center gap-4 cursor-pointer rounded-lg border border-dashed border-border py-12 hover:bg-accent/30 transition-colors">
            <input
              type="file"
              accept="image/*,application/pdf,application/json,text/plain"
              className="hidden"
              onChange={onPick}
              disabled={upload.isPending}
            />
            {upload.isPending ? (
              <>
                <Loader2 className="size-8 animate-spin text-primary" />
                <div className="text-sm text-muted-foreground">Processando com IA…</div>
              </>
            ) : (
              <>
                <Upload className="size-8 text-primary" />
                <div className="text-center">
                  <div className="font-medium">Clique para enviar um cardápio</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    PNG · JPG · PDF · JSON · até 15 MB
                  </div>
                </div>
              </>
            )}
          </label>
        </Card>

        <section className="grid lg:grid-cols-[300px_1fr] gap-6">
          <Card className="p-4 bg-card border-border h-fit">
            <h2 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wider">
              Histórico
            </h2>
            <div className="space-y-1">
              {(uploadsQ.data || []).length === 0 && (
                <div className="text-xs text-muted-foreground py-6 text-center">
                  Nenhum cardápio enviado ainda.
                </div>
              )}
              {(uploadsQ.data || []).map((u) => (
                <div
                  key={u.id}
                  className={`group flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer transition-colors ${
                    activeUpload === u.id ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                  onClick={() => setActiveUpload(u.id)}
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{u.filename}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {u.status === "processing" && "processando…"}
                      {u.status === "done" && "pronto"}
                      {u.status === "error" && (
                        <span className="text-destructive">erro</span>
                      )}
                      {u.status === "pending" && "aguardando"}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeUpload.mutate(u.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6 bg-card border-border min-h-[300px]">
            {!activeUpload ? (
              <div className="text-sm text-muted-foreground text-center py-16">
                Selecione um cardápio no histórico ou envie um novo para ver os itens extraídos.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-lg font-medium">Itens extraídos</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(itemsQ.data || []).length} itens · salvos no banco
                    </p>
                  </div>
                  <Button
                    onClick={exportExcel}
                    disabled={!itemsQ.data?.length}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Download className="size-4 mr-2" />
                    Baixar Excel
                  </Button>
                </div>

                {itemsQ.isLoading && (
                  <div className="text-sm text-muted-foreground">Carregando…</div>
                )}

                {!itemsQ.isLoading && grouped.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-10">
                    Nenhum item encontrado neste cardápio.
                  </div>
                )}

                <div className="space-y-6">
                  {grouped.map(([cat, items]) => (
                    <div key={cat}>
                      <div className="text-xs uppercase tracking-wider text-primary mb-2">
                        {cat}
                      </div>
                      <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
                        {items.map((it) => (
                          <div
                            key={it.id}
                            className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3 hover:bg-accent/30"
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-medium">{it.name}</div>
                              {it.description && (
                                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                  {it.description}
                                </div>
                              )}
                            </div>
                            <div className="text-sm tabular-nums text-primary self-center">
                              {it.price != null
                                ? new Intl.NumberFormat("pt-BR", {
                                    style: "currency",
                                    currency: it.currency || "BRL",
                                  }).format(it.price)
                                : "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </section>
      </main>

      <footer className="border-t border-border mt-16">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-foreground flex justify-between">
          <span>Extração e Preparação de Dados · IBMEC</span>
          <span>Pipeline: Upload → Gemini → Banco → Excel</span>
        </div>
      </footer>
    </div>
  );
}
