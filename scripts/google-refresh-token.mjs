// Obtiene un GOOGLE_REFRESH_TOKEN para el calendario que va a enviar las invitaciones.
// Uso:  GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/google-refresh-token.mjs
// Requisito: credencial OAuth tipo "Web application" con redirect URI http://localhost:5555/callback
import http from "node:http";

const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error("Define GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET");
  process.exit(1);
}
const redirect = "http://localhost:5555/callback";
const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
auth.search = new URLSearchParams({
  client_id: id,
  redirect_uri: redirect,
  response_type: "code",
  access_type: "offline",
  prompt: "consent",
  scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy",
}).toString();

console.log("\nAbre esta URL e inicia sesión con la cuenta dueña del calendario:\n\n" + auth + "\n");

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, redirect);
    const code = url.searchParams.get("code");
    if (!code) return res.end("Sin código");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }),
    });
    const json = await r.json();
    res.end("Listo, vuelve a la terminal.");
    console.log(json.refresh_token ? `GOOGLE_REFRESH_TOKEN=${json.refresh_token}` : json);
    process.exit(0);
  })
  .listen(5555);
