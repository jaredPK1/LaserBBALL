// Local API server: `npm run dev` runs this alongside Vite (which proxies /api here).
import 'dotenv/config';
import app from './app.js';

const port = Number(process.env.API_PORT) || 3001;
app.listen(port, () => console.log(`Hoop Intel API on http://localhost:${port}`));
