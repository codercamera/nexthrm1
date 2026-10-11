export type Row = Record<string, any>;
export async function request(
  path: string,
  method = "GET",
  body?: any,
): Promise<any> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers:
      body instanceof FormData
        ? {}
        : body
          ? { "Content-Type": "application/json" }
          : {},
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Invalid server response" }));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export const money = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(
    (n || 0) / 100,
  );
export const localDate = (v: string) =>
  v
    ? new Date(v.length === 10 ? v + "T12:00:00+07:00" : v).toLocaleString(
        "th-TH",
        {
          timeZone: "Asia/Bangkok",
          ...(v.length === 10
            ? { year: "numeric", month: "short", day: "numeric" }
            : { dateStyle: "medium", timeStyle: "short" }),
        },
      )
    : "—";
