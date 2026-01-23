import { Router } from 'express';
import { testRunnerService } from '../services/test-runner.service.js';

export const testRunnerRouter = Router();

// GET /api/test-runner/status - Get current test run status
testRunnerRouter.get('/status', (_req, res) => {
  res.json({ success: true, data: testRunnerService.getStatus() });
});

// GET /api/test-runner/reports - Check which reports exist
testRunnerRouter.get('/reports', (_req, res) => {
  res.json({ success: true, data: testRunnerService.getReportStatus() });
});

// POST /api/test-runner/run/:type - Start a test run
testRunnerRouter.post('/run/:type', async (req, res) => {
  const { type } = req.params;

  const validTypes = ['unit', 'e2e', 'feature-coverage', 'code-coverage'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({
      success: false,
      error: `Invalid test type. Must be one of: ${validTypes.join(', ')}`,
    });
  }

  // Check if a run is already in progress before starting
  const currentStatus = testRunnerService.getStatus();
  if (currentStatus?.status === 'running') {
    return res.status(409).json({
      success: false,
      error: 'A test run is already in progress',
    });
  }

  // Start the test run asynchronously
  testRunnerService.runTests(type as 'unit' | 'e2e' | 'feature-coverage' | 'code-coverage')
    .catch(err => console.error('Test run error:', err.message));

  // Return immediately with the run started
  res.json({
    success: true,
    data: { message: `Started ${type} tests`, status: testRunnerService.getStatus() },
  });
});

// POST /api/test-runner/stop - Stop current test run
testRunnerRouter.post('/stop', (_req, res) => {
  const stopped = testRunnerService.stopTests();
  res.json({ success: stopped, data: { stopped } });
});

// GET /api/test-runner/events - SSE stream for test output
testRunnerRouter.get('/events', (req, res) => {
  const clientId = testRunnerService.addClient(res);

  req.on('close', () => {
    testRunnerService.removeClient(clientId);
  });
});
