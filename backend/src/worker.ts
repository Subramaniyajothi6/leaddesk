// Run the background jobs in their own process: RUN_JOBS=0 on the API, then `npm run worker`.
import { startJobs } from './jobs/scheduler.js'
startJobs()
console.log('LeadDesk worker running')
