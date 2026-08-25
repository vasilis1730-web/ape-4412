/* ══════════════════════════════════════════════════════════════════════
   Άντληση επίσημων στοιχείων από το ΚΗΜΔΗΣ Open Data API.

   Γιατί υπάρχει: τα κρατικά API δεν στέλνουν CORS headers, οπότε ο browser
   απαγορεύει την απευθείας κλήση από την εφαρμογή. Η κλήση γίνεται εδώ,
   στον server, και το αποτέλεσμα επιστρέφει «καθαρό» στην εφαρμογή.

   Το API του ΚΗΜΔΗΣ είναι ανοιχτό και δωρεάν — δεν απαιτείται κλειδί.
   Τεκμηρίωση: https://cerpp.eprocurement.gov.gr/khmdhs-opendata/help
   Swagger:    https://cerpp.eprocurement.gov.gr/khmdhs-opendata/swagger-ui/index.html

   Δύο λειτουργίες:
   · POST {q: "24SYMV012345678"}  — αναζήτηση κατά ΑΔΑΜ (REQ / PROC / AWRD /
     SYMV) ή κατά Α/Α ΕΣΗΔΗΣ (σκέτος αριθμός). Επιστρέφει το πλήρες JSON
     της εγγραφής όπως το δίνει το ΚΗΜΔΗΣ (πεδίο raw) — η εφαρμογή διαλέγει
     τι θα χρησιμοποιήσει, ώστε τυχόν νέα πεδία να μη χάνονται.
   · POST {attachment: "24SYMV012345678"} — μεταφέρει το πρωτότυπο PDF της
     πράξης (διακήρυξη, σύμβαση κ.λπ.), ώστε να το διαβάσουν οι υπάρχοντες
     αναγνώστες της εφαρμογής.
   ══════════════════════════════════════════════════════════════════════ */

const BASE = "https://cerpp.eprocurement.gov.gr/khmdhs-opendata";
const MAX_PDF = 20 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* Ο τύπος της πράξης προκύπτει από τον ΑΔΑΜ και ορίζει το endpoint:
   ##REQ######### → πρωτογενές αίτημα      → /request
   ##PROC######## → προκήρυξη / διακήρυξη  → /notice
   ##AWRD######## → κατακύρωση / ανάθεση   → /award
   ##SYMV######## → σύμβαση                → /contract */
const ADAM_RE = /^(\d{2})(REQ|PROC|AWRD|SYMV)(\d{9})$/;
const PATHS: Record<string, string[]> = {
  REQ:  ["request"],
  PROC: ["notice"],
  AWRD: ["award", "awardnotice", "awrd"],   // εφεδρικές γραφές, αν διαφέρει η ονομασία
  SYMV: ["contract"],
};

async function kimdhs(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${BASE}/${path}?page=0`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { /* μη-JSON απάντηση */ }
  return { status: r.status, data, text: data ? "" : text.slice(0, 400) };
}

const contentOf = (d: unknown): unknown[] => {
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object" && Array.isArray((d as { content?: unknown[] }).content))
    return (d as { content: unknown[] }).content;
  return [];
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") return json({ error: "Δεκτό μόνο POST." }, 405);
    const { q, attachment } = await req.json();

    /* ── μεταφορά του πρωτότυπου PDF μιας πράξης ── */
    if (attachment) {
      const m = String(attachment).toUpperCase().match(ADAM_RE);
      if (!m) return json({ error: "Μη έγκυρος ΑΔΑΜ." }, 400);
      const path = PATHS[m[2]][0];
      const r = await fetch(`${BASE}/${path}/attachment/${m[0]}`);
      if (!r.ok) return json({ error: `Το ΚΗΜΔΗΣ απάντησε ${r.status} για το συνημμένο.` }, 502);
      const buf = await r.arrayBuffer();
      if (buf.byteLength > MAX_PDF) return json({ error: "Το συνημμένο ξεπερνά τα 20 MB." }, 413);
      return new Response(buf, {
        headers: {
          ...CORS,
          "Content-Type": r.headers.get("Content-Type") || "application/pdf",
          "Content-Disposition": `attachment; filename="${m[0]}.pdf"`,
        },
      });
    }

    /* ── αναζήτηση κατά ΑΔΑΜ ή Α/Α ΕΣΗΔΗΣ ── */
    const query = String(q || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!query) return json({ error: "Δώστε ΑΔΑΜ ή Α/Α ΕΣΗΔΗΣ." }, 400);

    const m = query.match(ADAM_RE);
    if (m) {
      const errors: string[] = [];
      for (const path of PATHS[m[2]]) {
        const r = await kimdhs(path, { referenceNumber: m[0] });
        const rows = contentOf(r.data);
        if (r.status === 200 && rows.length)
          return json({ ok: true, kind: m[2], endpoint: path, adam: m[0],
            attachmentUrl: `${BASE}/${path}/attachment/${m[0]}`, raw: rows[0], rawAll: rows });
        errors.push(`${path}: ${r.status}${r.text ? " " + r.text : ""}${r.status === 200 ? " (κενό)" : ""}`);
      }
      return json({ error: `Δεν βρέθηκε εγγραφή για τον ΑΔΑΜ ${m[0]} στο ΚΗΜΔΗΣ.`, detail: errors.join(" · ") }, 404);
    }

    if (/^\d{4,10}(,\d+)?$/.test(query)) {
      /* Α/Α ΕΣΗΔΗΣ: αναζήτηση πρώτα στις συμβάσεις, μετά στις διακηρύξεις. */
      const tries: { endpoint: string; kind: string }[] = [
        { endpoint: "contract", kind: "SYMV" },
        { endpoint: "notice", kind: "PROC" },
      ];
      for (const t of tries) {
        const r = await kimdhs(t.endpoint, { aaht: query });
        const rows = contentOf(r.data);
        if (r.status === 200 && rows.length)
          return json({ ok: true, kind: t.kind, endpoint: t.endpoint, aaht: query, raw: rows[0], rawAll: rows });
      }
      return json({ error: `Δεν βρέθηκε εγγραφή στο ΚΗΜΔΗΣ για Α/Α ΕΣΗΔΗΣ ${query}.` }, 404);
    }

    return json({ error: "Μη αναγνωρίσιμη μορφή. Δεκτά: ΑΔΑΜ (π.χ. 24SYMV012345678) ή Α/Α ΕΣΗΔΗΣ (αριθμός)." }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("kimdis-lookup:", msg);
    return json({ error: "Η επικοινωνία με το ΚΗΜΔΗΣ απέτυχε.", detail: msg }, 502);
  }
});
