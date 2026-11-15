import type { Contact, Finding } from '../../shared/types'

export interface AuditResult { findings: Finding[]; screenshot: Buffer | null; contacts: Contact[]; error?: string }
