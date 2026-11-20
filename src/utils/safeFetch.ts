export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown
): Promise<T> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const rawText = await resp.text();
  let parsed: Record<string, unknown> | null = null;

  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }

  if (!resp.ok) {
    const serverErr =
      parsed && typeof parsed.error === "string" ? parsed.error : null;
    if (serverErr) {
      throw new Error(serverErr);
    }
    if (resp.status === 504 || resp.status === 502) {
      throw new Error(
        "O servidor demorou para responder. Tente novamente em instantes."
      );
    }
    throw new Error(
      `Erro ${resp.status} ao comunicar com o servidor do Orbi.`
    );
  }

  if (!parsed) {
    throw new Error("Resposta inesperada do servidor. Tente novamente.");
  }

  return parsed as T;
}
