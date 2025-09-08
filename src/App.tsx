/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useRef } from "react";
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
import { LAMPORTS_PER_SOL } from "./constants/solana";
import { toPLNDate } from "./utils/date";
import { motion } from "framer-motion";
import { Loader2, Search, Eye, Download } from "lucide-react";
import { LOCALES } from "./config";

const App = () => {
  const [input, setInput] = useState("");
  const [recipient, setRecipient] = useState("");
  const [invoice, setInvoice] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<GetTransactionResponse | null>(null);
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [lang, setLang] = useState<"pl" | "ru" | "en">("pl");
  const [showPreview, setShowPreview] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const t = LOCALES[lang];

  const signature = useMemo(() => parseSignature(input) ?? "", [input]);

  async function handleFetch() {
    setError(null);
    setTx(null);
    setAnalysis(null);
    const sig = signature;
    if (!sig) {
      setError(t.validTxLink);
      return;
    }
    setLoading(true);
    try {
      const res = await rpcGetTransaction(sig);
      if (!res) throw new Error(t.noTxOrRPC);
      if (!res.meta) throw new Error(t.noMetadata);

      const { message } = res.transaction;

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
        const parties = inferParties(message);
        report = { type: "none", ...parties };
      }

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
      setError((error as Error).message || t.rpcError);
    } finally {
      setLoading(false);
    }
  }

  const generatePDFContent = () => {
    if (!analysis || !tx) return "";

    const created = new Date().toLocaleString(t.code, {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    return `
      <div class="pdf-content" style="
        font-family: 'DejaVu Sans', Arial, sans-serif;
        font-size: 11px;
        line-height: 1.4;
        color: #1f2937;
        max-width: 21cm;
        margin: 0 auto;
        padding: 2cm;
        background: white;
        min-height: 29.7cm;
        box-sizing: border-box;
      ">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="
            font-size: 18px;
            font-weight: bold;
            margin: 0 0 8px 0;
            color: #111827;
            letter-spacing: -0.01em;
          ">${t.docTitle}</h1>
          <div style="font-size: 12px; color: #6b7280;">${
            t.network
          }: Solana</div>
        </div>

        <!-- Separator -->
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">

        <!-- Document Info -->
        <div style="margin-bottom: 25px;">
          <h2 style="font-size: 13px; font-weight: bold; margin: 0 0 12px 0; color: #111827;">
            ${t.documentInfo}
          </h2>
          <div style="display: grid; grid-template-columns: 150px 1fr; gap: 8px; font-size: 10px;">
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.dateCreated}:</span>
              <span>${created}</span>
            </div>
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.docNumber}:</span>
              <span>SOL-${analysis.signature.slice(0, 12).toUpperCase()}</span>
            </div>
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.system}:</span>
              <span>Solana Transaction Reporter</span>
            </div>
          </div>
        </div>

        <!-- Transaction Details -->
        <div style="margin-bottom: 25px;">
          <h2 style="font-size: 13px; font-weight: bold; margin: 0 0 12px 0; color: #111827;">
            ${t.txDetails}
          </h2>
          <div style="display: grid; grid-template-columns: 150px 1fr; gap: 8px; font-size: 10px;">
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.dateTime}:</span>
              <span>${analysis.time || "-"}</span>
            </div>
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.slot}:</span>
              <span>${analysis.slot?.toString() || "-"}</span>
            </div>
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.txId}:</span>
              <span style="word-break: break-all;">${short(
                analysis.signature
              )}</span>
            </div>
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.recipientWallet}:</span>
              <span style="word-break: break-all;">${
                analysis.recipient || "—"
              }</span>
            </div>
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.senderWallet}:</span>
              <span style="word-break: break-all;">${
                analysis.sender || "—"
              }</span>
            </div>
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.fee}:</span>
              <span>${(analysis.feeLamports / LAMPORTS_PER_SOL).toLocaleString(
                t.code,
                { maximumFractionDigits: 9 }
              )} SOL</span>
            </div>
          </div>
        </div>

        <!-- Received Funds -->
        <div style="margin-bottom: 25px;">
          <h2 style="font-size: 13px; font-weight: bold; margin: 0 0 12px 0; color: #111827;">
            ${t.received}
          </h2>
          <div style="display: grid; grid-template-columns: 150px 1fr; gap: 8px; font-size: 10px;">
            ${
              analysis.asset.kind === "SOL"
                ? `
              <div style="display: contents;">
                <span style="font-weight: bold;">${t.amountReceived}:</span>
                <span>${analysis.asset.amount.toLocaleString(t.code, {
                  maximumFractionDigits: 9,
                })} SOL</span>
              </div>
              <div style="display: contents;">
                <span style="font-weight: bold;">${t.assetType}:</span>
                <span>SOL</span>
              </div>
            `
                : analysis.asset.kind === "SPL"
                ? `
              <div style="display: contents;">
                <span style="font-weight: bold;">${t.assetType}:</span>
                <span>SPL Token</span>
              </div>
              <div style="display: contents;">
                <span style="font-weight: bold;">${t.mint}:</span>
                <span style="word-break: break-all;">${
                  analysis.asset.mint
                }</span>
              </div>
              <div style="display: contents;">
                <span style="font-weight: bold;">${t.amount}:</span>
                <span>${analysis.asset.amount?.toString() || "-"}</span>
              </div>
              <div style="display: contents;">
                <span style="font-weight: bold;">${t.decimals}:</span>
                <span>${analysis.asset.decimals?.toString() || "-"}</span>
              </div>
            `
                : `
              <div style="display: contents;">
                <span style="font-weight: bold;">${t.amountReceived}:</span>
                <span>—</span>
              </div>
              <div style="display: contents;">
                <span style="font-weight: bold;">${t.assetType}:</span>
                <span>Unknown</span>
              </div>
            `
            }
          </div>
        </div>

        ${
          invoice
            ? `
        <!-- Invoice Info -->
        <div style="margin-bottom: 25px;">
          <h2 style="font-size: 13px; font-weight: bold; margin: 0 0 12px 0; color: #111827;">
            ${t.invoiceInfo}
          </h2>
          <div style="display: grid; grid-template-columns: 150px 1fr; gap: 8px; font-size: 10px;">
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.invoiceNumber}:</span>
              <span>${invoice}</span>
            </div>
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.paymentDesc}:</span>
              <span>${description || "-"}</span>
            </div>
          </div>
        </div>
        `
            : ""
        }

        <!-- Technical Details -->
        <div style="margin-bottom: 25px;">
          <h2 style="font-size: 13px; font-weight: bold; margin: 0 0 12px 0; color: #111827;">
            ${t.techDetails}
          </h2>
          <div style="display: grid; grid-template-columns: 150px 1fr; gap: 8px; font-size: 10px;">
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.explorerUrl}:</span>
              <span style="word-break: break-all; color: #2563eb;">${
                analysis.explorerUrl
              }</span>
            </div>
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.blockchain}:</span>
              <span>Solana Mainnet-Beta</span>
            </div>
            <div style="display: contents;">
              <span style="font-weight: bold;">${t.protocol}:</span>
              <span>JSON-RPC</span>
            </div>
          </div>
        </div>

        <!-- Declaration -->
        <div style="margin-bottom: 30px;">
          <h2 style="font-size: 12px; font-weight: bold; margin: 0 0 10px 0; color: #111827;">
            ${t.declarationTitle}
          </h2>
          <div style="font-size: 10px; line-height: 1.5; text-align: justify;">
            ${t.declaration}
          </div>
          <div style="font-size: 9px; color: #6b7280; margin-top: 10px; word-break: break-all;">
            ${analysis.explorerUrl}
          </div>
        </div>

        <!-- Footer -->
        <div style="
          position: absolute;
          bottom: 2cm;
          left: 2cm;
          right: 2cm;
          border-top: 1px solid #e5e7eb;
          padding-top: 15px;
          font-size: 9px;
          text-align: center;
          color: #6b7280;
        ">
          <div style="margin-bottom: 8px;">
            ${t.footerGenerated}: ${created}
          </div>
          <div>${t.footerSystem}</div>
        </div>
      </div>
    `;
  };

  const downloadPDF = () => {
    if (!analysis) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const pdfContent = generatePDFContent();

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${t.docTitle} - ${analysis.signature.slice(0, 8)}</title>
          <style>
            @page {
              size: A4;
              margin: 0;
            }
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'DejaVu Sans', Arial, sans-serif;
              background: white;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          ${pdfContent}
        </body>
      </html>
    `);

    printWindow.document.close();

    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="flex justify-between items-center mb-8">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-bold text-slate-800"
          >
            {t.title}
          </motion.h1>

          <div className="flex items-center gap-2">
            {["pl", "ru", "en"].map((langCode) => (
              <button
                key={langCode}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  lang === langCode
                    ? "bg-indigo-600 text-white shadow-md"
                    : "bg-white/70 backdrop-blur-sm border border-white/20 text-slate-700 hover:bg-white/90"
                }`}
                onClick={() => setLang(langCode as "pl" | "ru" | "en")}
              >
                {langCode.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl border border-white/20 p-8"
        >
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t.signatureInput}
              </label>
              <input
                className="w-full rounded-xl border-2 border-slate-200 bg-white/90 px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-0 focus:outline-none transition-colors"
                placeholder={t.sigPlaceholder}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t.recipient}
                </label>
                <input
                  className="w-full rounded-xl border-2 border-slate-200 bg-white/90 px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-0 focus:outline-none transition-colors"
                  placeholder={t.recipientPlaceholder}
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim())}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t.invoice}
                </label>
                <input
                  className="w-full rounded-xl border-2 border-slate-200 bg-white/90 px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-0 focus:outline-none transition-colors"
                  placeholder={t.invoicePlaceholder}
                  value={invoice}
                  onChange={(e) => setInvoice(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t.description}
              </label>
              <input
                className="w-full rounded-xl border-2 border-slate-200 bg-white/90 px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-0 focus:outline-none transition-colors"
                placeholder={t.descriptionPlaceholder}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleFetch}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-white font-medium shadow-lg hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Search className="h-5 w-5" />
                )}
                {t.fetchBtn}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowPreview(true)}
                disabled={!analysis}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-white font-medium shadow-lg hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                <Eye className="h-5 w-5" />
                {t.previewBtn}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={downloadPDF}
                disabled={!analysis}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-600 px-6 py-3 text-white font-medium shadow-lg hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                <Download className="h-5 w-5" />
                {t.downloadBtn}
              </motion.button>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-red-800"
              >
                {error}
              </motion.div>
            )}

            {analysis && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 p-6"
              >
                <div className="grid md:grid-cols-2 gap-6 text-sm">
                  <div className="space-y-4">
                    <div>
                      <div className="text-slate-500 font-medium mb-1">
                        {t.dateTime} (Europe/Warsaw)
                      </div>
                      <div className="font-semibold text-slate-900">
                        {analysis.time}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 font-medium mb-1">
                        Transaction
                      </div>
                      <a
                        className="font-semibold text-indigo-600 hover:text-indigo-800 hover:underline transition-colors"
                        href={analysis.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(analysis.signature, 6)}
                      </a>
                    </div>
                    <div>
                      <div className="text-slate-500 font-medium mb-1">
                        {t.recipientWallet}
                      </div>
                      <div className="font-mono text-slate-900 break-all">
                        {analysis.recipient
                          ? short(analysis.recipient, 8)
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="text-slate-500 font-medium mb-1">
                        {t.senderWallet}
                      </div>
                      <div className="font-mono text-slate-900 break-all">
                        {analysis.sender ? short(analysis.sender, 8) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 font-medium mb-1">
                        {t.assetType}
                      </div>
                      <div className="font-semibold text-slate-900">
                        {analysis.asset.kind === "SOL" && (
                          <span className="text-green-700">
                            {analysis.asset.amount.toLocaleString(t.code, {
                              maximumFractionDigits: 9,
                            })}{" "}
                            SOL
                          </span>
                        )}
                        {analysis.asset.kind === "SPL" && (
                          <div>
                            <span className="text-blue-700">
                              {analysis.asset.amount.toLocaleString(t.code)}
                              {t.tokens}
                            </span>
                            <div className="text-xs text-slate-500 mt-1">
                              Mint: {short(analysis.asset.mint, 6)}
                            </div>
                          </div>
                        )}
                        {analysis.asset.kind === "Unknown" && <span>—</span>}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 font-medium mb-1">
                        {t.fee}
                      </div>
                      <div className="font-semibold text-slate-900">
                        {(
                          analysis.feeLamports / LAMPORTS_PER_SOL
                        ).toLocaleString(t.code, {
                          maximumFractionDigits: 9,
                        })}{" "}
                        SOL
                      </div>
                    </div>
                  </div>
                </div>

                {invoice && (
                  <div className="mt-6 rounded-xl bg-white/60 border border-blue-200 p-4">
                    <div className="text-slate-500 font-medium mb-1">
                      {t.invoiceNumber}
                    </div>
                    <div className="font-semibold text-slate-900 mb-2">
                      {invoice}
                    </div>
                    {description && (
                      <div className="text-sm text-slate-700">
                        {description}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="flex items-start gap-2">
                <div className="text-slate-400 mt-0.5">💡</div>
                <div>{t.hint}</div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Preview Modal */}
        {showPreview && analysis && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-200">
                <h3 className="text-xl font-semibold text-slate-900">
                  {t.previewBtn}
                </h3>
                <div className="flex items-center gap-3">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={downloadPDF}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-white font-medium hover:bg-indigo-700 transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    {t.downloadBtn}
                  </motion.button>
                  <button
                    onClick={() => setShowPreview(false)}
                    className="rounded-lg bg-slate-100 p-2 text-slate-600 hover:bg-slate-200 transition-colors"
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="overflow-auto max-h-[calc(90vh-100px)]">
                <div
                  ref={printRef}
                  className="transform scale-75 origin-top"
                  style={{ transformOrigin: "top center" }}
                  dangerouslySetInnerHTML={{ __html: generatePDFContent() }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default App;
