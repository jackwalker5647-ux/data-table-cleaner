import { useState } from "react";

export default function ToolFeedback() {
  const [choice, setChoice] = useState(null);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(helpful, extraComment = "") {
    setLoading(true);
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        helpful,
        comment: extraComment,
        page: window.location.href,
        context: "after_clean",
      }),
    });
    setLoading(false);
    setSent(true);
  }

  if (sent) return <p style={{ marginTop: 16 }}>Thanks! 🙌</p>;

  return (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
      <strong>Did this tool help?</strong>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button disabled={loading} onClick={() => submit("Yes")}>
          👍 Yes
        </button>
        <button disabled={loading} onClick={() => setChoice("No")}>
          👎 No
        </button>
      </div>

      {choice === "No" && (
        <div style={{ marginTop: 12 }}>
          <p>What was missing? (optional)</p>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ width: "100%" }}
          />
          <div style={{ marginTop: 8 }}>
            <button disabled={loading} onClick={() => submit("No", comment)}>
              Send
            </button>
            <button disabled={loading} onClick={() => submit("No")}>
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
