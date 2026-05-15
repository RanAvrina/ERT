import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'

export const healthRouter = Router()

healthRouter.get('/', (_request, response) => {
  response.json({
    ok: true,
    service: 'ert-server',
    timestamp: new Date().toISOString(),
  })
})

healthRouter.get('/ready', async (_request, response) => {
  const { error } = await supabaseAdmin.from('accounts').select('id', { head: true }).limit(1)

  if (error) {
    response.status(503).json({
      ok: false,
      service: 'ert-server',
      ready: false,
      error: 'Database connection failed.',
      timestamp: new Date().toISOString(),
    })
    return
  }

  response.json({
    ok: true,
    service: 'ert-server',
    ready: true,
    timestamp: new Date().toISOString(),
  })
})
