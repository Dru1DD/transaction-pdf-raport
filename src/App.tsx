/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import type { GetTransactionResponse } from "./types/solana";
import {
  buildExplorerUrl,
  findDeltaSOL,
  findDeltaSPL,
  inferParties,
  parseSignature,
  rpcGetTransaction,
  short,
} from "./utils/blockchain";
import jsPDF from "jspdf";
import { LAMPORTS_PER_SOL } from "./constants/solana";
import { toPLNDate } from "./utils/date";
import { motion } from "framer-motion";
import { FileDown, Loader2, Search } from "lucide-react";

const App = () => {
  const [input, setInput] = useState("");
  const [recipient, setRecipient] = useState(""); // user's wallet (optional, improves accuracy)
  const [invoice, setInvoice] = useState("");
  const [description, setDescription] = useState("Płatność zgodna z fakturą");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<GetTransactionResponse | null>(null);
  const [analysis, setAnalysis] = useState<any | null>(null);

  const signature = useMemo(() => parseSignature(input) ?? "", [input]);

  async function handleFetch() {
    setError(null);
    setTx(null);
    setAnalysis(null);
    const sig = signature;
    if (!sig) {
      setError("Введите корректную ссылку на транзакцию или хэш (signature).");
      return;
    }
    setLoading(true);
    try {
      const res = await rpcGetTransaction(sig);
      if (!res) throw new Error("Транзакция не найдена или RPC недоступен");
      if (!res.meta)
        throw new Error("Нет метаданных по транзакции (meta=null)");

      const { message } = res.transaction;

      // Try SPL first (covers USDC etc.), then SOL
      const spl = findDeltaSPL(res.meta, message, recipient || undefined);
      const sol = findDeltaSOL(res.meta, message, recipient || undefined);

      let report: any = { type: "unknown" };
      if (spl && spl.delta > 0) {
        report = {
          type: "spl",
          mint: spl.mint,
          amountRaw: spl.delta,
          decimals: spl.decimals,
          amountUi: spl.delta / Math.pow(10, spl.decimals),
          recipient:
            recipient ||
            spl.owner ||
            message.accountKeys[spl.accountIndex]?.pubkey,
        };
      } else if (sol.deltaLamports > 0) {
        report = {
          type: "sol",
          amountLamports: sol.deltaLamports,
          amountSOL: sol.deltaLamports / LAMPORTS_PER_SOL,
          recipient: recipient || message.accountKeys[sol.index]?.pubkey,
        };
      } else {
        // Fallback: infer parties without positive delta (e.g., swaps)
        const parties = inferParties(message);
        report = { type: "none", ...parties };
      }

      // Try to infer sender from parsed instructions
      let sender: string | undefined = undefined;
      try {
        const parsedIx = res.transaction.message.instructions.find(
          (ix) => ix.parsed?.info
        );
        const info = parsedIx?.parsed?.info;
        sender =
          info?.source ||
          info?.authority ||
          info?.owner ||
          inferParties(message).sender;
      } catch {
        sender = inferParties(message).sender;
      }

      setTx(res);
      setAnalysis({
        signature: sig,
        explorerUrl: buildExplorerUrl(sig),
        slot: res.slot,
        time: res.blockTime ? toPLNDate(res.blockTime) : "-",
        feeLamports: res.meta.fee,
        sender,
        recipient: (report as any).recipient,
        asset:
          report.type === "spl"
            ? {
                kind: "SPL",
                mint: report.mint,
                amount: report.amountUi,
                decimals: report.decimals,
              }
            : report.type === "sol"
            ? { kind: "SOL", amount: report.amountSOL }
            : { kind: "Unknown" },
      });
    } catch (error) {
      setError((error as Error).message || "Ошибка запроса к RPC");
    } finally {
      setLoading(false);
    }
  }

  function downloadPDF() {
    if (!analysis || !tx) return;

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    const contentWidth = pageWidth - 2 * margin;
    let y = 60; // Start higher on the page

    // Helper functions
    const addText = (
      text: string,
      opts: Partial<{
        bold: boolean;
        size: number;
        align: "left" | "center" | "right";
        maxWidth?: number;
        link?: string;
      }> = {}
    ) => {
      const { bold = false, size = 12, align = "left", maxWidth, link } = opts;

      doc.setFontSize(size);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setTextColor("#000000"); // Always black text

      const lines = doc.splitTextToSize(text, maxWidth || contentWidth);
      const lineHeight = size * 1.2;

      let textX = margin;
      if (align === "center") {
        textX = pageWidth / 2;
      } else if (align === "right") {
        textX = pageWidth - margin;
      }

      // Add clickable link if provided
      if (link) {
        const textWidth = doc.getTextWidth(text);
        const linkX = align === "center" ? textX - textWidth / 2 : textX;
        doc.link(linkX, y - size, textWidth, lineHeight, { url: link });
      }

      doc.text(lines as any, textX, y, {
        align: align === "left" ? undefined : align,
      });
      y += (lines as string[]).length * lineHeight;
      return y;
    };

    const addSpace = (space: number) => {
      y += space;
    };

    const addLine = (thickness: number = 0.5) => {
      doc.setDrawColor("#CCCCCC");
      doc.setLineWidth(thickness);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;
    };

    const addSection = (
      title: string,
      content: () => void,
      spacing: number = 15
    ) => {
      // Check if we need a new page
      if (y > pageHeight - 150) {
        doc.addPage();
        y = 60;
      }

      addText(title, { bold: true, size: 14 });
      addLine(1);
      addSpace(10);

      content();
      addSpace(spacing);
    };

    const addKeyValue = (
      key: string,
      value: string,
      link?: string,
      keyWidth: number = 150
    ) => {
      const currentY = y;

      // Key (label)
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor("#000000");
      doc.text(key + ":", margin, y);

      // Value
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor("#000000");

      const valueLines = doc.splitTextToSize(
        value,
        contentWidth - keyWidth - 10
      );
      const valueX = margin + keyWidth;

      if (link) {
        const firstLineWidth = doc.getTextWidth(valueLines[0] as string);
        doc.link(valueX, y - 11, firstLineWidth, 14, { url: link });
      }

      doc.text(valueLines, valueX, y);
      y += Math.max(14, (valueLines as string[]).length * 14);
    };

    // Header
    addText("RAPORT POTWIERDZAJĄCY OTRZYMANIE ŚRODKÓW", {
      bold: true,
      size: 18,
      align: "center",
    });

    addSpace(5);
    addText("Sieć Blockchain: Solana", {
      size: 12,
      align: "center",
    });

    addSpace(20);
    addLine(2);
    addSpace(20);

    // Document Information Section
    addSection("INFORMACJE O DOKUMENCIE", () => {
      const docDate = new Date().toLocaleString("pl-PL", {
        timeZone: "Europe/Warsaw",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      addKeyValue("Data sporządzenia", docDate);
      addKeyValue(
        "Numer dokumentu",
        `SOL-${analysis.signature.slice(0, 12).toUpperCase()}`
      );
      addKeyValue("System", "Solana Transaction Reporter");
    });

    // Transaction Summary Section
    addSection("SZCZEGÓŁY TRANSAKCJI", () => {
      addKeyValue("Data i czas", analysis.time);
      addKeyValue("Slot", analysis.slot.toString());

      const shortSig =
        analysis.signature.slice(0, 16) + "..." + analysis.signature.slice(-16);
      addKeyValue("ID Transakcji", shortSig, analysis.explorerUrl);

      addKeyValue(
        "Portfel odbiorcy",
        analysis.recipient
          ? analysis.recipient.slice(0, 16) +
              "..." +
              analysis.recipient.slice(-16)
          : "—"
      );

      addKeyValue(
        "Portfel nadawcy",
        analysis.sender
          ? analysis.sender.slice(0, 16) + "..." + analysis.sender.slice(-16)
          : "—"
      );

      const feeText = `${(
        analysis.feeLamports / LAMPORTS_PER_SOL
      ).toLocaleString("pl-PL", {
        maximumFractionDigits: 9,
      })} SOL`;
      addKeyValue("Opłata sieciowa", feeText);
    });

    // Asset Information Section
    addSection("OTRZYMANE ŚRODKI", () => {
      let assetInfo = "";

      if (analysis.asset.kind === "SOL") {
        assetInfo = `${analysis.asset.amount.toLocaleString("pl-PL", {
          maximumFractionDigits: 9,
        })} SOL`;
      } else if (analysis.asset.kind === "SPL") {
        assetInfo = `${analysis.asset.amount.toLocaleString("pl-PL")} tokenów`;
        addKeyValue("Typ aktywów", "SPL Token");
        addKeyValue(
          "Mint Address",
          analysis.asset.mint.slice(0, 16) +
            "..." +
            analysis.asset.mint.slice(-16)
        );
        addKeyValue("Ilość", analysis.asset.amount.toLocaleString("pl-PL"));
        addKeyValue(
          "Precyzja (decimals)",
          analysis.asset.decimals?.toString() || "—"
        );
      } else {
        assetInfo = "Nie udało się jednoznacznie ustalić";
      }

      if (analysis.asset.kind !== "SPL") {
        addKeyValue("Kwota otrzymana", assetInfo);
        addKeyValue("Typ aktywów", analysis.asset.kind);
      }
    });

    // Invoice Section (if present)
    if (invoice) {
      addSection("INFORMACJE O FAKTURZE", () => {
        addKeyValue("Numer faktury", invoice);
        addKeyValue(
          "Opis płatności",
          description || "Płatność zgodna z fakturą"
        );
      });
    }

    // Technical Details Section
    addSection("DANE TECHNICZNE", () => {
      addKeyValue(
        "Explorer URL",
        "Otwórz w przeglądarce",
        analysis.explorerUrl
      );
      addKeyValue("Blockchain", "Solana Mainnet-Beta");
      addKeyValue("Protokół", "JSON-RPC");
    });

    // Legal Declaration Section
    addSpace(20);
    addLine(1);
    addSpace(15);

    addText("OŚWIADCZENIE", { bold: true, size: 14 });
    addSpace(10);

    const declaration = `Niniejszy dokument stanowi automatycznie wygenerowane potwierdzenie wpływu środków na wskazany portfel w sieci Solana. Wszystkie dane pochodzą bezpośrednio z publicznego łańcucha bloków poprzez zapytania JSON-RPC.
  
  Dokument został sporządzony zgodnie z najlepszymi praktykami raportowania transakcji blockchain i może służyć jako dowód otrzymania płatności.
  
  Weryfikacja danych możliwa jest poprzez bezpośrednie sprawdzenie transakcji w eksploratorze blockchain pod adresem: ${analysis.explorerUrl}`;

    addText(declaration, { size: 10, maxWidth: contentWidth });

    // Footer
    if (y > pageHeight - 100) {
      doc.addPage();
      y = 60;
    }

    // Position footer at bottom
    y = pageHeight - 80;
    addLine(0.5);
    addSpace(10);

    addText(
      `Dokument wygenerowany: ${new Date().toLocaleString("pl-PL", {
        timeZone: "Europe/Warsaw",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })}`,
      {
        size: 9,
        align: "center",
      }
    );

    addSpace(5);
    addText("System: Solana Transaction Reporter", {
      size: 9,
      align: "center",
    });

    // Save the PDF
    const filename = `Raport_Solana_${analysis.signature.slice(0, 8)}_${
      new Date().toISOString().split("T")[0]
    }.pdf`;
    doc.save(filename);
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-semibold mb-6"
        >
          Raport o получении средств (Solana)
        </motion.h1>

        <div className="grid gap-4">
          <label className="block">
            <span className="text-sm text-neutral-600">
              Ссылка на транзакцию (Solscan / Explorer / SolanaFM) или хэш
              (signature)
            </span>
            <input
              className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="например: https://solscan.io/tx/… или D8x… (signature)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-neutral-600">
                Ваш кошелёк (получатель) — необязательное, но повышает точность
              </span>
              <input
                className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="например: 4Nd1…"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value.trim())}
              />
            </label>

            <label className="block">
              <span className="text-sm text-neutral-600">
                Номер фактуры (опционально)
              </span>
              <input
                className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="FV-2025/09-001"
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm text-neutral-600">
              Описание / назначение платежа (для рапорта)
            </span>
            <input
              className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Płatność za fakturę FV-…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              onClick={handleFetch}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-white shadow hover:bg-indigo-700 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Search className="h-5 w-5" />
              )}
              Получить данные
            </button>
            <button
              onClick={downloadPDF}
              disabled={!analysis}
              className="inline-flex items-center gap-2 rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 shadow hover:bg-neutral-100 disabled:opacity-60"
            >
              <FileDown className="h-5 w-5" />
              Скачать рапорт (PDF)
            </button>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
              {error}
            </div>
          )}

          {analysis && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-neutral-500">Дата (Europe/Warsaw)</div>
                  <div className="font-medium">{analysis.time}</div>
                </div>
                <div>
                  <div className="text-neutral-500">Signature</div>
                  <a
                    className="font-medium text-indigo-600 hover:underline"
                    href={analysis.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(analysis.signature, 6)}
                  </a>
                </div>
                <div>
                  <div className="text-neutral-500">Получатель</div>
                  <div className="font-medium">{analysis.recipient || "—"}</div>
                </div>
                <div>
                  <div className="text-neutral-500">Отправитель</div>
                  <div className="font-medium">{analysis.sender || "—"}</div>
                </div>
                <div>
                  <div className="text-neutral-500">Актив</div>
                  <div className="font-medium">
                    {analysis.asset.kind === "SOL" && (
                      <span>
                        {analysis.asset.amount.toLocaleString("pl-PL", {
                          maximumFractionDigits: 9,
                        })}{" "}
                        SOL
                      </span>
                    )}
                    {analysis.asset.kind === "SPL" && (
                      <span>
                        {analysis.asset.amount.toLocaleString("pl-PL")} tokenów
                        <span className="text-neutral-500">
                          {" "}
                          (mint: {short(analysis.asset.mint)})
                        </span>
                      </span>
                    )}
                    {analysis.asset.kind === "Unknown" && (
                      <span>Nie udało się jednoznacznie ustalić</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-neutral-500">Сетевой сбор (fee)</div>
                  <div className="font-medium">
                    {(analysis.feeLamports / LAMPORTS_PER_SOL).toLocaleString(
                      "pl-PL",
                      { maximumFractionDigits: 9 }
                    )}{" "}
                    SOL
                  </div>
                </div>
              </div>
              {invoice && (
                <div className="mt-4 rounded-2xl bg-neutral-50 p-4 text-sm">
                  <div className="text-neutral-500">Faktura</div>
                  <div className="font-medium">{invoice}</div>
                  {description && (
                    <div className="text-neutral-700 mt-1">{description}</div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          <div className="text-xs text-neutral-500 mt-4">
            Подсказка: можно вставить либо ссылку на Solscan / Explorer /
            SolanaFM, либо сам хэш транзакции (signature). Для более точного
            определения получателя укажите ваш адрес кошелька.
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
