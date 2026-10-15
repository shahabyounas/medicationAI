import { Router } from 'express';
import { patientsRouter } from './patients.js';
import { recordsRouter } from './records.js';
import { prescriptionsRouter } from './prescriptions.js';
import { dosesRouter } from './doses.js';
import { agentRouter } from './agent.js';
import { intakeRouter } from './intake.js';
import { pushRouter } from './push.js';
import { healthRouter } from './health.js';

export const apiRouter: Router = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', at: new Date().toISOString() });
});

apiRouter.use('/patients', patientsRouter);
apiRouter.use('/doses', dosesRouter);
apiRouter.use('/agent', agentRouter);
apiRouter.use('/intake', intakeRouter);
apiRouter.use('/push', pushRouter);
// Side effects, readings, symptoms, appointments, results and self-care. The
// matching reads hang off the patient, in `patients.ts`.
apiRouter.use('/', healthRouter);
// Doctors, visits and conditions share a router; so do medications,
// prescriptions and reports. Both mount at the API root.
apiRouter.use('/', recordsRouter);
apiRouter.use('/', prescriptionsRouter);
