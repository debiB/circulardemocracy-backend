import { serve } from '@hono/node-server'
import { config } from 'dotenv'
import app from './src/index'

// Load environment variables
config()

// Mock AI Binding
const mockAI = {
  run: async (model: string, inputs: any) => {
    console.log(`[Mock AI] Running model: ${model}`)
    // Return mock response based on model
    if (model.includes('bge-m3')) {
      // Return embedding
      return {
        shape: [1, 3],
        data: [[0.1, 0.2, 0.3]] // Simplified embedding
      }
    }
    // Default fallback
    return { result: 'mocked response' }
  }
}

// Create bindings object
const bindings = {
  AI: mockAI,
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://mock-supabase.co',
  SUPABASE_KEY: process.env.SUPABASE_KEY || 'mock-key',
  API_KEY: process.env.API_KEY || 'mock-api-key'
}

console.log('Starting local server with bindings:', {
  ...bindings,
  AI: '[Mock AI]',
  SUPABASE_KEY: bindings.SUPABASE_KEY ? '***' : 'missing',
  API_KEY: bindings.API_KEY ? '***' : 'missing'
})

serve({
  fetch: (request) => {
    // Inject bindings into the request execution
    return app.fetch(request, bindings)
  },
  port: 8787
}, (info) => {
  console.log(`Local server running at http://localhost:${info.port}`)
  console.log(`Test with: curl -H "x-api-key: ${bindings.API_KEY}" http://localhost:${info.port}/api/v1/messages ...`)
})
