/* ══════════════════════════════════════════════════════════════════════
   Ανάγνωση σαρωμένου προϋπολογισμού ή Ανακεφαλαιωτικού Πίνακα.

   Γιατί υπάρχει: ο τοπικός αναγνώστης της εφαρμογής διαβάζει μόνο PDF που
   περιέχουν κείμενο. Σε σαρωμένο ή φωτογραφημένο πίνακα δεν υπάρχει κείμενο,
   και η κλασική OCR στα ελληνικά αποτυγχάνει στους πυκνούς πίνακες: σε
   μετρήσεις πάνω σε καθαρή εικόνα έβγαλε 7 από 21 αριθμούς σωστά, και τους
   υπόλοιπους λάθος — «241,00 5,00 1.205,00» έγινε «9806 ἀθδ 2665».
   Λάθος ποσά σε έγγραφο που πάει σε Τεχνικό Συμβούλιο είναι απαράδεκτα,
   γι' αυτό η ανάγνωση πίνακα γίνεται εδώ, με μοντέλο που καταλαβαίνει δομή.

   Ό,τι επιστρέφεται περνά ΥΠΟΧΡΕΩΤΙΚΑ από τον έλεγχο της εφαρμογής:
   ποσότητα × τιμή = δαπάνη σε κάθε γραμμή, και άθροισμα έναντι του
   «Αθροίσματος» του εγγράφου. Καμία τιμή δεν μπαίνει σε υπολογισμό
   χωρίς να έχει επαληθευτεί αριθμητικά.

   Δύο τρόποι λειτουργίας:
   · mode «pinakas» (προεπιλογή) — δομημένη ανάγνωση πίνακα εργασιών.
   · mode «keimeno»  — απλή μεταγραφή σε κείμενο, για διοικητικά έγγραφα
     (αποφάσεις, συμβάσεις, πρωτόκολλα). Το κείμενο επιστρέφει στην εφαρμογή
     και περνά από τους ίδιους αναγνώστες που ήδη χρησιμοποιούνται για τα
     ψηφιακά PDF, ώστε να μην υπάρχουν δύο διαφορετικές λογικές εξαγωγής.
   ══════════════════════════════════════════════════════════════════════ */

import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import { z } from "npm:zod@4.4.3";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.120.0/helpers/zod";

const MAX_BYTES = 12 * 1024 * 1024;   // ~12 MB μετά την αποκωδικοποίηση
const MODEL = "claude-opus-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* Το σχήμα είναι σκόπιμα κοντά στο μοντέλο δεδομένων της εφαρμογής, ώστε οι
   γραμμές να μπαίνουν κατευθείαν στο βήμα 2 χωρίς ενδιάμεση μετάφραση. */
const Arthro = z.object({
  at:        z.string().describe("Ο αύξων αριθμός τιμολογίου (Α.Τ.), π.χ. «1.01». Κενό αν δεν φαίνεται."),
  kodikos:   z.string().describe("Ο κωδικός άρθρου, π.χ. «ΝΑΟΙΚ 22.23» ή «ΑΤΗΕ 8751.1.3». Κενό αν δεν φαίνεται."),
  kodAnath:  z.string().describe("Ο κωδικός αναθεώρησης, π.χ. «ΟΙΚ 2252» ή «ΗΛΜ 44». Κενό αν δεν φαίνεται."),
  perigrafi: z.string().describe("Η περιγραφή της εργασίας, όπως ακριβώς γράφεται."),
  monada:    z.string().describe("Η μονάδα μέτρησης, π.χ. m2, m3, kg, ΤΕΜ, μμ."),
  posotita:  z.number().describe("Η ποσότητα ως αριθμός. Το ελληνικό «1.205,50» γίνεται 1205.50."),
  timi:      z.number().describe("Η τιμή μονάδας ως αριθμός."),
  dapani:    z.number().describe("Η δαπάνη όπως ΓΡΑΦΕΤΑΙ στο έγγραφο. Χρησιμεύει για διασταύρωση — μην την υπολογίσεις."),
  avevaio:   z.boolean().describe("true αν οποιοδήποτε μέγεθος της γραμμής δεν διαβάζεται με βεβαιότητα."),
});

const Omada = z.object({
  name:  z.string().describe("Ο τίτλος της ομάδας εργασιών, π.χ. «ΧΩΜΑΤΟΥΡΓΙΚΑ - ΚΑΘΑΙΡΕΣΕΙΣ»."),
  items: z.array(Arthro),
});

const Apotelesma = z.object({
  einai_pinakas: z.boolean().describe("false αν η εικόνα δεν είναι προϋπολογισμός ή Ανακεφαλαιωτικός Πίνακας."),
  eidos:   z.enum(["proypologismos", "ape", "alo"]).describe("Τι είδους έγγραφο είναι."),
  ergo:    z.string().describe("Ο τίτλος του έργου από την κεφαλίδα. Κενό αν δεν φαίνεται."),
  geoe:    z.number().nullable().describe("Ποσοστό Γ.Ε. & Ο.Ε., π.χ. 18. null αν δεν φαίνεται."),
  apr:     z.number().nullable().describe("Ποσοστό απροβλέπτων, π.χ. 15. null αν δεν φαίνεται."),
  fpa:     z.number().nullable().describe("Ποσοστό Φ.Π.Α., π.χ. 24. null αν δεν φαίνεται."),
  athroisma: z.number().nullable().describe("Το «Άθροισμα» των εργασιών όπως γράφεται. null αν δεν φαίνεται."),
  groups:  z.array(Omada),
  simeioseis: z.string().describe("Ό,τι δεν διαβάστηκε καθαρά, ή κενό."),
});

const SYSTEM = `Διαβάζεις σαρωμένους ελληνικούς προϋπολογισμούς δημοσίων έργων και
Ανακεφαλαιωτικούς Πίνακες Εργασιών, και τους μεταφέρεις σε δομημένα δεδομένα.

Κανόνες που δεν παραβιάζονται:
· Αντιγράφεις ΜΟΝΟ ό,τι βλέπεις. Δεν συμπληρώνεις, δεν διορθώνεις, δεν μαντεύεις.
· Αν ένα μέγεθος δεν διαβάζεται με βεβαιότητα, σημειώνεις avevaio: true στη γραμμή.
  Είναι προτιμότερο να σημανθεί μια σωστή γραμμή ως αβέβαιη, παρά να περάσει
  απαρατήρητη μια λάθος.
· Η δαπάνη μπαίνει όπως ΓΡΑΦΕΤΑΙ στο χαρτί. Δεν την υπολογίζεις από ποσότητα ×
  τιμή — χρησιμεύει ακριβώς για να διασταυρωθεί ανεξάρτητα.
· Οι ελληνικοί αριθμοί γράφονται «1.205,50»: η τελεία χωρίζει χιλιάδες, το κόμμα
  είναι η υποδιαστολή. Το αποδίδεις ως 1205.50.
· Οι κωδικοί άρθρου και αναθεώρησης τυπώνονται συχνά κολλητά, σε διάφορες γραφές:
  «ΝΑΟΙΚ 22.23  ΟΙΚ 2252», «ΟΙΚ ΚΠΤ-22.60-ΑΟΙΚ2236=100%», «ΑΤΗΕ 8751.1.3ΗΛΜ 44».
  Τα ξεχωρίζεις στα δύο πεδία τους.
· Γραμμές συνόλων, μεταφορών και σελιδοποίησης ΔΕΝ είναι άρθρα. Τις παραλείπεις.
· Ο τίτλος ομάδας συνήθως προηγείται αριθμημένος («1. ΧΩΜΑΤΟΥΡΓΙΚΑ»). Ο αριθμός
  δεν ανήκει στο όνομα.`;

const SYSTEM_TEXT = `Μεταγράφεις σαρωμένα ελληνικά διοικητικά έγγραφα δημοσίων έργων
(αποφάσεις, συμβάσεις, πρωτόκολλα, βεβαιώσεις) σε απλό κείμενο.

Κανόνες που δεν παραβιάζονται:
· Αντιγράφεις ΜΟΝΟ ό,τι βλέπεις. Δεν συμπληρώνεις, δεν διορθώνεις, δεν μαντεύεις.
· Διατηρείς τη σειρά και τη διάταξη: μια γραμμή του χαρτιού, μια γραμμή κειμένου.
· Αντιγράφεις ΑΥΤΟΛΕΞΕΙ τα αναγνωριστικά, χαρακτήρα προς χαρακτήρα, χωρίς να
  «διορθώσεις» ό,τι σου φαίνεται παράξενο: ΑΔΑ (16 χαρακτήρες με παύλες),
  ΑΔΑΜ, αριθμό πρωτοκόλλου, αριθμό απόφασης, ΑΦΜ, αριθμό ΕΣΗΔΗΣ, ημερομηνίες,
  ποσά. Αυτά είναι ο λόγος που διαβάζεται το έγγραφο.
· Αν ένας χαρακτήρας δεν διαβάζεται, τον γράφεις «?». Δεν τον μαντεύεις.
· Δεν προσθέτεις σχόλια, τίτλους, περιλήψεις ή μορφοποίηση markdown.
  Επιστρέφεις μόνο το κείμενο του εγγράφου.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") return json({ error: "Δεκτό μόνο POST." }, 405);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) {
      return json({ error: "Δεν έχει ρυθμιστεί το ANTHROPIC_API_KEY στο Edge Function." }, 500);
    }

    const { mime, data, filename, mode } = await req.json();
    if (!mime || !data) return json({ error: "Λείπει το αρχείο." }, 400);

    const asText = mode === "keimeno";

    // Το base64 είναι ~4/3 του πραγματικού μεγέθους
    if (data.length * 0.75 > MAX_BYTES) {
      return json({ error: `Το αρχείο ξεπερνά τα ${MAX_BYTES / 1048576} MB.` }, 413);
    }

    const isPdf = mime === "application/pdf";
    const isImg = /^image\/(png|jpe?g|webp|gif)$/.test(mime);
    if (!isPdf && !isImg) {
      return json({ error: `Μη υποστηριζόμενος τύπος αρχείου: ${mime}` }, 415);
    }

    const client = new Anthropic({ apiKey: key });

    /* Το PDF περνά ως document, η εικόνα ως image. Και στις δύο περιπτώσεις
       προηγείται του κειμένου, όπως ορίζει η τεκμηρίωση. */
    const doc = isPdf
      ? { type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
      : { type: "image" as const,
          source: { type: "base64" as const, media_type: mime as
            "image/png" | "image/jpeg" | "image/webp" | "image/gif", data } };

    /* Μεταγραφή σε κείμενο: δεν επιβάλλεται σχήμα, γιατί το αποτέλεσμα το
       διαβάζουν οι ίδιοι αναγνώστες που δουλεύουν ήδη πάνω σε ψηφιακά PDF. */
    if (asText) {
      const t = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: SYSTEM_TEXT,
        messages: [{
          role: "user",
          content: [
            doc,
            { type: "text",
              text: `Μετάγραψε σε κείμενο αυτό το έγγραφο${
                filename ? ` («${String(filename).slice(0, 120)}»)` : ""
              }, ακολουθώντας τους κανόνες.` },
          ],
        }],
      });
      const keimeno = t.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n")
        .trim();
      if (!keimeno) return json({ error: "Δεν διαβάστηκε κείμενο από το έγγραφο." }, 422);
      return json({
        ok: true,
        mode: "keimeno",
        keimeno,
        usage: {
          input_tokens: t.usage?.input_tokens ?? null,
          output_tokens: t.usage?.output_tokens ?? null,
        },
      });
    }

    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          doc,
          { type: "text",
            text: `Μετάφερε τον πίνακα αυτού του εγγράφου${
              filename ? ` («${String(filename).slice(0, 120)}»)` : ""
            } σε δομημένα δεδομένα, ακολουθώντας τους κανόνες.` },
        ],
      }],
      output_config: { format: zodOutputFormat(Apotelesma) },
    });

    if (res.stop_reason === "refusal") {
      return json({ error: "Το μοντέλο αρνήθηκε να επεξεργαστεί το έγγραφο." }, 422);
    }
    if (!res.parsed_output) {
      return json({ error: "Το αποτέλεσμα δεν είχε την αναμενόμενη μορφή." }, 502);
    }

    const out = res.parsed_output;
    if (!out.einai_pinakas) {
      return json({
        error: "Το έγγραφο δεν φαίνεται να είναι προϋπολογισμός ή Ανακεφαλαιωτικός Πίνακας.",
        simeioseis: out.simeioseis,
      }, 422);
    }

    return json({
      ok: true,
      ...out,
      usage: {
        input_tokens: res.usage?.input_tokens ?? null,
        output_tokens: res.usage?.output_tokens ?? null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("ocr-pinaka:", msg);
    // Ο πελάτης δεν χρειάζεται λεπτομέρειες υποδομής, αλλά χρειάζεται να ξέρει τι φταίει
    const known = /rate limit|overloaded|timeout|too large|credit/i.test(msg);
    return json({ error: known ? msg : "Η ανάγνωση απέτυχε. Δείτε τα logs του Edge Function." }, 502);
  }
});
