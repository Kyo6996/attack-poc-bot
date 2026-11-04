// Obtiene el GOOGLE_REFRESH_TOKEN de la cuenta que crea los eventos y envía los correos.
// Uso:  GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/google-refresh-token.mjs
// Credencial OAuth tipo "App de escritorio": no requiere registrar la URL de retorno.
import http from "node:http";

const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error("Define GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET");
  process.exit(1);
}
const port = 5555;
const redirect = `http://127.0.0.1:${port}/callback`;
const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
auth.search = new URLSearchParams({
  client_id: id,
  redirect_uri: redirect,
  response_type: "code",
  access_type: "offline",
  prompt: "consent",
  scope: [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.freebusy",
    "https://www.googleapis.com/auth/gmail.send",
  ].join(" "),
}).toString();

console.log("\nAbre esta URL e inicia sesión con la cuenta que enviará las invitaciones:\n\n" + auth + "\n");

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, redirect);
    const code = url.searchParams.get("code");
    if (!code) return res.end(url.searchParams.get("error") ?? "Sin código");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }),
    });
    const json = await r.json();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>Listo. Ya puedes cerrar esta pestaña y volver a la terminal.</h2>");
    console.log(json.refresh_token ? `GOOGLE_REFRESH_TOKEN=${json.refresh_token}` : json);
    process.exit(0);
  })
  .listen(port, "127.0.0.1");
