import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

type EvolutionUpsertMessage = {
  key?: {
    remoteJid?: string
    fromMe?: boolean
    participant?: string
  }
  message?: Record<string, unknown>
}

function extractText(message: Record<string, unknown> | undefined): string | null {
  if (!message) return null

  const m = message as any
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    null
  )
}

function extractSenderNumber(msg: EvolutionUpsertMessage): string | null {
  const remoteJid = msg.key?.remoteJid
  const participant = msg.key?.participant

  const jid = participant ?? remoteJid
  if (!jid) return null

  // remoteJid examples:
  // - "237xxxxxxxx@s.whatsapp.net"
  // - "237xxxxxxxx@c.us"
  // - group: "1203xxxxx@g.us" (participant then contains sender)
  return jid.split("@")[0] ?? null
}

async function safeJson(req: Request): Promise<any> {
  try {
    const contentType = req.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().includes("application/json")) return null
    return await req.json()
  } catch (_err) {
    return null
  }
}

serve(async (req) => {
  // Toujours répondre 200 à Evolution API pour éviter les retries.
  // On log les erreurs mais on ne "crash" jamais la réponse.
  try {
    if (req.method !== "POST") {
      return new Response("OK", { status: 200 })
    }

    const body = (await safeJson(req)) ?? {}

    // Evolution API (MESSAGES_UPSERT) peut varier selon la config.
    // On supporte quelques variantes courantes, sans jamais crasher si le body est incomplet.
    let messages: EvolutionUpsertMessage[] = []
    if (Array.isArray(body?.data?.messages)) {
      messages = body.data.messages
    } else if (Array.isArray(body?.messages)) {
      messages = body.messages
    } else if (body?.data?.message) {
      messages = [body.data.message]
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response("OK", { status: 200 })
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
      return new Response("OK", { status: 200 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    for (const msg of messages) {
      if (msg?.key?.fromMe === true) continue

      const from = extractSenderNumber(msg)
      const text = extractText((msg.message ?? {}) as Record<string, unknown>)

      if (!from || !text) continue

      try {
        const { error } = await supabase.functions.invoke("whatsapp-handler", {
          body: {
            from,
            text,
            raw: body,
          },
        })

        if (error) {
          console.error("whatsapp-handler invoke error:", error)
        }
      } catch (err) {
        console.error("whatsapp-handler invoke exception:", err)
      }
    }

    return new Response("OK", { status: 200 })
  } catch (err) {
    console.error("whatsapp-webhook fatal error:", err)
    return new Response("OK", { status: 200 })
  }
})
