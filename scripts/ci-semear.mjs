// Semeia o banco DESCARTÁVEL do CI com o mínimo para os testes de integração
// rodarem (um cliente e um caso fictícios). Nunca rode contra produção: o
// script se recusa se DB_NAME não terminar em "_ci".
import mysql from 'mysql2/promise';

const { DB_HOST = '127.0.0.1', DB_PORT = '3306', DB_USER = 'root', DB_PASSWORD = '', DB_NAME = '' } = process.env;
if (!DB_NAME.endsWith('_ci')) { console.error(`Recusado: DB_NAME="${DB_NAME}" não é um banco de CI (precisa terminar em _ci).`); process.exit(1); }

const c = await mysql.createConnection({ host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD, database: DB_NAME });
const [[admin]] = await c.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
if (!admin) { console.error('Rode o seed do admin antes.'); process.exit(1); }
const [[ja]] = await c.query("SELECT id FROM clients WHERE email = 'cliente.ci@teste.local'");
let clientId = ja?.id;
if (!clientId) {
  const [r] = await c.query("INSERT INTO clients (name, email, phone, status, created_by) VALUES ('Cliente Fictício CI', 'cliente.ci@teste.local', '27900000000', 'ativo', ?)", [admin.id]);
  clientId = r.insertId;
}
const [[caso]] = await c.query('SELECT id FROM cases WHERE client_id = ? LIMIT 1', [clientId]);
if (!caso) await c.query("INSERT INTO cases (user_id, client_id, title, legal_area) VALUES (?, ?, 'Caso fictício do CI', 'trabalhista')", [admin.id, clientId]);
console.log(`Banco do CI semeado: cliente ${clientId} e um caso.`);
await c.end();
