import { getConnection } from '../lib/database.js';
import { handleApp } from '../lib/app-handler.js';

export default {
  async fetch(request) {
    try {
      const { db } = await getConnection();
      return await handleApp(request, db, { adminEmail: process.env.ADMIN_EMAIL, adminPassword: process.env.ADMIN_PASSWORD });
    } catch (error) {
      console.error('Mess API unavailable:', error.message);
      return Response.json({ error: 'The database is not available. The administrator needs to check the deployment configuration.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
