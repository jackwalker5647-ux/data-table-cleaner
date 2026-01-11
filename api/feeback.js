export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const { helpful, comment = "", page = "", context = "" } = req.body || {};

    const action = process.env.GOOGLE_FORM_ACTION_URL;
    if (!action) {
      res.status(500).send("Missing GOOGLE_FORM_ACTION_URL");
      return;
    }

    // ⬇️ Replace these with your real entry IDs
    const ENTRY_HELPFUL = "entry.1652807388";
    const ENTRY_COMMENT = "entry.1942438713";
    const ENTRY_PAGE = "entry.1425833670";
    const ENTRY_CONTEXT = "entry.1444159722";

    const body = new URLSearchParams();
    body.append(ENTRY_HELPFUL, helpful);
    body.append(ENTRY_COMMENT, comment);
    body.append(ENTRY_PAGE, page);
    body.append(ENTRY_CONTEXT, context);

    await fetch(action, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(400).send("Bad Request");
  }
}
