export async function POST(req: Request) {
  try {
    // 1. Read data sent from the browser
    const { helpful, comment = "", page = "", context = "" } = await req.json();

    // 2. Read the Google Form POST URL from env
    const action = process.env.GOOGLE_FORM_ACTION_URL;
    if (!action) {
      return new Response("Missing GOOGLE_FORM_ACTION_URL", { status: 500 });
    }

    // 3. ⬇️ REPLACE these with your real Google Form entry IDs
    const ENTRY_HELPFUL = "entry.1652807388";
    const ENTRY_COMMENT = "entry.1942438713";
    const ENTRY_PAGE = "entry.1425833670";
    const ENTRY_CONTEXT = "entry.1444159722";

    // 4. Build form-encoded body for Google
    const body = new URLSearchParams();
    body.append(ENTRY_HELPFUL, helpful);   // "Yes" or "No"
    body.append(ENTRY_COMMENT, comment);
    body.append(ENTRY_PAGE, page);
    body.append(ENTRY_CONTEXT, context);

    // 5. POST to Google Form (server-side)
    await fetch(action, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
    });

    // 6. Respond back to the browser
    return Response.json({ ok: true });
  } catch (err) {
    return new Response("Invalid request", { status: 400 });
  }
}
