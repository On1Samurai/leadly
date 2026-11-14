import tls from 'node:tls'

/** Reads certificate validity only: connects with rejectUnauthorized:false, sends nothing, closes at once. */
export function checkCert(host: string, timeoutMs = 10000): Promise<{ valid: boolean; validTo: number } | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: { valid: boolean; validTo: number } | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { socket.destroy() } catch { /* ignore */ }
      resolve(v)
    }
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const validTo = Date.parse(socket.getPeerCertificate().valid_to)
      const valid = socket.authorized
      socket.end()
      finish(Number.isNaN(validTo) ? null : { valid, validTo })
    })
    const timer = setTimeout(() => finish(null), timeoutMs)
    socket.on('error', () => finish(null))
  })
}
