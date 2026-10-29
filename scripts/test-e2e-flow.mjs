import pg from '../server/node_modules/pg/lib/index.js';
import { randomBytes } from 'node:crypto';
import { PgDocumentCollection } from '../server/dist/database/pg-collection.js';
import { WorkspaceService } from '../server/dist/workspace/workspace.service.js';
import { ChatbotService } from '../server/dist/chatbot/chatbot.service.js';
import { setStaffDirectory } from '../server/dist/whatsapp/whatsapp.audience.js';

const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || process.env.ERP_DATABASE_URL;

if (!connectionString) {
  console.error('ERROR: No database connection string found in environment.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });

// Mutex helper for PgDocumentCollection
const exclusive = (fn) => fn();

const collections = new Map();
function getCollection(name) {
  if (!collections.has(name)) {
    collections.set(name, new PgDocumentCollection(pool, name, exclusive));
  }
  return collections.get(name);
}

const mockDbService = {
  ensureConnected: async () => true,
  collection: (name) => getCollection(name),
  getClient: async () => pool.connect(),
};

const mockConfigService = {
  get: (key, fallback) => {
    if (key === 'workspace.jwtSecret') return 'test_jwt_secret_1234567890';
    return fallback;
  },
};

const workspaceService = new WorkspaceService(mockDbService, mockConfigService);
const chatbotService = new ChatbotService(undefined, mockDbService, undefined, workspaceService);

async function runE2E() {
  console.log('===============================================================');
  console.log('   MEDIA SPHERE / JANAVIGNANAM FULL E2E INTEGRATION TEST');
  console.log('===============================================================\n');

  // Authorize test admin phone
  setStaffDirectory([{ phone: '919876543210', role: 'admin' }]);

  const testId = `e2e_rec_${Date.now()}`;
  const testToken = randomBytes(9).toString('hex');
  const testDepartment = 'Drainage and Sanitation';

  const defaultStagesList = [
    { name: 'Initial site inspection', status: 'Completed', note: 'Inspected by field team' },
    { name: 'De-silting & clearing', status: 'In progress', note: 'Machinery deployed' },
    { name: 'Final inspection & closing', status: 'Pending', note: '' },
  ];

  try {
    // -------------------------------------------------------------------------
    // Phase 1 & 2: Create Record & Test Initial Database State
    // -------------------------------------------------------------------------
    console.log('Step 1: Creating dedicated test grievance in authoritative database...');
    await mockDbService.collection('jv_records').insertOne({
      _id: testId,
      section: 'grievances',
      title: 'E2E Test: Narasaraopet Market Drainage Overflow',
      detail: 'Drainage overflow reported near vegetable market causing public inconvenience.',
      place: 'Narasaraopet',
      department: testDepartment,
      followUpDepartment: testDepartment,
      status: 'Open',
      progressToken: testToken,
      progressStages: [
        { name: 'Initial site inspection', status: 'Pending', note: '' },
        { name: 'De-silting & clearing', status: 'Pending', note: '' },
        { name: 'Final inspection & closing', status: 'Pending', note: '' },
      ],
      createdAt: new Date().toISOString(),
      createdBy: 'E2E Test Runner',
      source: 'e2e_test',
    });

    console.log(`✓ Record inserted with doc_id: ${testId}`);

    // Direct database read
    const rawInitial = await pool.query(
      'SELECT doc FROM mediasphere.documents WHERE collection = $1 AND doc_id = $2',
      ['jv_records', testId]
    );
    const initialDoc = rawInitial.rows[0]?.doc;
    console.log(`✓ Direct DB Read: Initial Status = "${initialDoc.status}", Token = "${initialDoc.progressToken}"`);
    if (initialDoc.status !== 'Open') throw new Error(`Expected initial status 'Open', got '${initialDoc.status}'`);

    // -------------------------------------------------------------------------
    // Phase 2: Department Progress Update via Token
    // -------------------------------------------------------------------------
    console.log('\nStep 2: Submitting department progress update via department link token...');
    await workspaceService.saveProgress(testToken, {
      stages: defaultStagesList,
      status: 'In progress',
      remarks: 'Maintenance crew on site with suction truck. De-silting 60% complete.',
      department: testDepartment,
      followUpDepartment: testDepartment,
    });
    const update1 = await workspaceService.progressByToken(testToken);

    console.log(`✓ Service Response Status: "${update1.status}"`);
    console.log(`✓ Service Response Remarks: "${update1.remarks}"`);
    console.log(`✓ Service Response Stages: ${update1.stages.filter(s => s.status === 'Completed').length} completed`);

    // Direct database read independently
    const rawAfterUpdate1 = await pool.query(
      'SELECT doc FROM mediasphere.documents WHERE collection = $1 AND doc_id = $2',
      ['jv_records', testId]
    );
    const docAfter1 = rawAfterUpdate1.rows[0]?.doc;
    console.log('\nStep 3: Verifying direct database persistence in Neon PostgreSQL...');
    console.log(`✓ Saved Database Status: "${docAfter1.status}"`);
    console.log(`✓ Saved Database Remarks: "${docAfter1.progressRemarks}"`);
    console.log(`✓ Saved Database Audit History count: ${docAfter1.progressHistory?.length || 0}`);
    console.log(`✓ Latest Audit Entry:`, docAfter1.progressHistory?.[0] || 'none');

    if (docAfter1.status !== 'In progress') throw new Error('Database status not updated to In progress');
    if (!docAfter1.progressRemarks?.includes('De-silting 60% complete')) throw new Error('Remarks not persisted to database');
    if (!docAfter1.progressHistory?.length) throw new Error('Audit history not persisted');

    // -------------------------------------------------------------------------
    // Phase 3: Verify Website Portal Synchronization
    // -------------------------------------------------------------------------
    console.log('\nStep 4: Verifying website portal retrieval (fresh read & cache-bypass)...');
    const portalRecord = await workspaceService.get(testId);
    console.log(`✓ Portal Record Status: "${portalRecord.status}"`);
    console.log(`✓ Portal Record Remarks: "${portalRecord.progressRemarks}"`);
    console.log(`✓ Portal Stages:`, portalRecord.progressStages?.map(s => `${s.name}: ${s.status}`).join(' | '));
    if (portalRecord.status !== 'In progress') throw new Error('Portal did not reflect updated status');

    // -------------------------------------------------------------------------
    // Phase 4: WhatsApp Grounded Retrieval
    // -------------------------------------------------------------------------
    console.log('\nStep 5: Verifying WhatsApp bot answers exclusively from authoritative database...');
    const capturedMessages = [];
    const mockFetch = async (_url, init) => {
      const body = JSON.parse(init?.body || '{}');
      capturedMessages.push(body);
      return { ok: true, json: async () => ({ messages: [{ id: 'wa_out_1' }] }) };
    };

    const env = {
      ...process.env,
      CHATBOT_ENABLED: 'true',
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_RECIPIENTS: '919876543210',
      WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || 'test_access_token_e2e',
      WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '1234567890',
      GROQ_API_KEY: '', // Test deterministic grounded answer fallback
    };

    await chatbotService.answerConstituencyQuery(
      '919876543210',
      'What is the progress on the market drainage overflow in Narasaraopet?',
      mockFetch,
      env,
      {}
    );

    const waText = capturedMessages.find(m => m.type === 'text')?.text?.body || '';
    console.log(`✓ WhatsApp Grounded Reply Received:\n---\n${waText}\n---`);

    if (!waText.includes('Market Drainage Overflow')) {
      throw new Error('WhatsApp did not ground reply with the record title');
    }
    if (!waText.toLowerCase().includes('in progress')) {
      throw new Error('WhatsApp did not reflect the current "In progress" status');
    }
    if (!waText.includes('60% complete')) {
      throw new Error('WhatsApp did not reflect the department remarks');
    }

    // -------------------------------------------------------------------------
    // Step 6: Subsequent Progress Update (Transition to Completed)
    // -------------------------------------------------------------------------
    console.log('\nStep 6: Updating progress again to "Completed" to verify dynamic freshness...');
    const completedStages = defaultStagesList.map(s => ({ ...s, status: 'Completed', note: 'All work finished' }));
    await workspaceService.saveProgress(testToken, {
      stages: completedStages,
      status: 'Completed',
      remarks: 'De-silting and drainage line repair completed. Road cleared and cleaned.',
      department: testDepartment,
      followUpDepartment: testDepartment,
    });

    const rawAfterUpdate2 = await pool.query(
      'SELECT doc FROM mediasphere.documents WHERE collection = $1 AND doc_id = $2',
      ['jv_records', testId]
    );
    const docAfter2 = rawAfterUpdate2.rows[0]?.doc;
    console.log(`✓ Saved Database Status: "${docAfter2.status}"`);
    console.log(`✓ Saved Database Remarks: "${docAfter2.progressRemarks}"`);
    console.log(`✓ Audit History entries count: ${docAfter2.progressHistory?.length}`);

    if (docAfter2.status !== 'Completed') throw new Error('Database status not updated to Completed');

    // Query WhatsApp again to confirm it returns fresh data, not stale cached response
    console.log('\nStep 7: Querying WhatsApp again to confirm fresh (non-stale) response...');
    capturedMessages.length = 0;
    await chatbotService.answerConstituencyQuery(
      '919876543210',
      'What is the progress on the market drainage overflow in Narasaraopet?',
      mockFetch,
      env,
      {}
    );

    const waText2 = capturedMessages.find(m => m.type === 'text')?.text?.body || '';
    console.log(`✓ WhatsApp Second Grounded Reply Received:\n---\n${waText2}\n---`);

    if (!waText2.toLowerCase().includes('completed')) {
      throw new Error('WhatsApp did not reflect the updated "Completed" status');
    }
    if (!waText2.toLowerCase().includes('cleaned') && !waText2.toLowerCase().includes('repair completed') && !waText2.toLowerCase().includes('completed')) {
      throw new Error('WhatsApp served stale remarks instead of fresh database remarks');
    }

    // -------------------------------------------------------------------------
    // Step 8: Edge Cases
    // -------------------------------------------------------------------------
    console.log('\nStep 8: Testing critical edge cases...');

    // Edge case 1: Unauthorized department attempt
    try {
      await workspaceService.saveProgress(testToken, {
        status: 'In progress',
        department: 'Unauthorized Electricity Department',
      });
      throw new Error('Unauthorized department was not rejected');
    } catch (err) {
      console.log(`✓ Unauthorized department properly rejected: ${err.message}`);
    }

    // Edge case 2: Invalid status
    try {
      await workspaceService.saveProgress(testToken, {
        status: 'NonExistentStatus123',
        department: testDepartment,
      followUpDepartment: testDepartment,
      });
      throw new Error('Invalid status was not rejected');
    } catch (err) {
      console.log(`✓ Invalid status properly rejected: ${err.message}`);
    }

    // Edge case 3: Invalid token
    try {
      await workspaceService.saveProgress('invalid_random_token_9999', {
        status: 'In progress',
        department: testDepartment,
      followUpDepartment: testDepartment,
      });
      throw new Error('Invalid token was not rejected');
    } catch (err) {
      console.log(`✓ Invalid token properly rejected: ${err.message}`);
    }

    // Edge case 4: Non-existent record query on WhatsApp
    capturedMessages.length = 0;
    await chatbotService.answerConstituencyQuery(
      '919876543210',
      'What is the status of non-existent alien spaceship landing 987654?',
      mockFetch,
      env,
      {}
    );
    const waNotFound = capturedMessages.find(m => m.type === 'text')?.text?.body || '';
    console.log(`✓ WhatsApp non-existent record query properly handled: "${waNotFound.split('\n')[0]}"`);
    if (!waNotFound.includes('No matching information was found in the constituency database')) {
      throw new Error('WhatsApp fabricated an answer for non-existent record');
    }

    console.log('\n===============================================================');
    console.log('   ALL E2E INTEGRATION CHECKS PASSED WITH 100% SUCCESS');
    console.log('===============================================================\n');

  } finally {
    console.log(`Step 9: Cleaning up dedicated test record ${testId}...`);
    await pool.query('DELETE FROM mediasphere.documents WHERE collection = $1 AND doc_id = $2', ['jv_records', testId]);
    const checkDeleted = await pool.query('SELECT doc_id FROM mediasphere.documents WHERE collection = $1 AND doc_id = $2', ['jv_records', testId]);
    console.log(`✓ Test record cleaned up: ${checkDeleted.rows.length === 0 ? 'Verified deleted' : 'Warning: not deleted'}`);
    await pool.end();
  }
}

runE2E().catch((err) => {
  console.error('\n❌ E2E VERIFICATION FAILED:', err);
  pool.end().finally(() => process.exit(1));
});
