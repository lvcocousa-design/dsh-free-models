import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { FreeModelsKey } from './locales.ts'
import { add, addable, move, remove, routeEnabled, setRoute, toggle, untilText, usageRatio, usageText } from './model.ts'
import type { ChainEntry, ProviderStatus, RouterConfigView, StatusReport } from './model.ts'

export interface PageSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: RouterConfigView | undefined
  writable: boolean
}
export type StatusSnapshot = { report: StatusReport | undefined; failed: boolean }

export interface PageProps {
  t: (key: FreeModelsKey) => string
  /** Bound by the renderer from the injected `hooks` compartment. */
  useConfig: <R>(select: (snapshot: PageSnapshot) => R) => R
  useReport: <R>(select: (snapshot: StatusSnapshot) => R) => R
  write: (field: string, value: unknown) => void
  now: () => number
}

const card: CSSProperties = { border: '1px solid rgba(127,127,127,.3)', borderRadius: 10, padding: 14, marginBottom: 12 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }
const muted: CSSProperties = { opacity: 0.65, fontSize: 12 }
const button: CSSProperties = { border: '1px solid rgba(127,127,127,.4)', borderRadius: 6, background: 'transparent', color: 'inherit', padding: '2px 8px', cursor: 'pointer' }
const BADGE: Record<ProviderStatus['status'], string> = { ok: '#2e9d57', cooling: '#d99a1d', exhausted: '#d9534f', disabled: '#888' }

function Check(props: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label style={{ ...row, cursor: props.disabled ? 'default' : 'pointer' }}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={event => { props.onChange(event.target.checked) }} />
      <span>{props.children}</span>
    </label>
  )
}

function Bar(props: { ratio: number | undefined; color: string }) {
  if (props.ratio === undefined) return null
  return (
    <div style={{ height: 6, borderRadius: 3, background: 'rgba(127,127,127,.25)', overflow: 'hidden', margin: '6px 0' }}>
      <div style={{ width: `${Math.round(props.ratio * 100)}%`, height: '100%', background: props.color }} />
    </div>
  )
}

function ProviderCard(props: { p: ProviderStatus; confirmed: boolean; writable: boolean; t: PageProps['t']; now: number; onConfirm: (value: boolean) => void }) {
  const { p, t } = props
  const ratio = usageRatio(p)
  const back = untilText(p.until, props.now)
  const color = BADGE[p.status]
  return (
    <div style={card}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <strong>{p.displayName}</strong>
        <span style={{ color, fontWeight: 600 }}>{t(`status_${p.status}` as FreeModelsKey)}{back === undefined ? '' : ` · ${t('back')} ${back}`}</span>
      </div>
      <div style={muted}>{t('usageToday')}: {usageText(p)}</div>
      <Bar ratio={ratio} color={ratio !== undefined && ratio >= 0.8 ? BADGE.cooling : BADGE.ok} />
      <div style={muted}>{p.billingNotice}</div>
      {p.trainsOnFreeTierData ? <div style={muted}>{t('trains')}</div> : null}
      <div style={{ ...muted, marginTop: 4 }}>
        {t('keyRef')}: <code>{p.apiKeyEnv}</code> · <a href={p.keyUrl} target="_blank" rel="noreferrer">{t('getKey')}</a>
      </div>
      <Check checked={props.confirmed} disabled={!props.writable} onChange={props.onConfirm}>
        {t('confirmNoBilling')}{props.confirmed ? '' : ` (${t('confirmNeeded')})`}
      </Check>
      <div style={muted}>{p.models.map(m => `${m.name}${m.unverified ? ` (${t('unverified')})` : ''}`).join(' · ')}</div>
    </div>
  )
}

export function FreeModelsPage(props: PageProps) {
  const { t } = props
  const config = props.useConfig(snapshot => snapshot)
  const { report, failed } = props.useReport(snapshot => snapshot)
  const [pick, setPick] = useState('')
  const value = config.value ?? {}
  const chain: ChainEntry[] = value.chain ?? []
  const confirmed = value.confirmedNoBilling ?? {}
  const writable = config.status === 'ready' && config.writable
  const options = addable(report, chain)
  const now = props.now()

  return (
    <div style={{ maxWidth: 760 }}>
      <h2 style={{ marginBottom: 4 }}>{t('title')}</h2>
      <p style={muted}>{t('intro')}</p>

      <div style={card}>
        <strong>{t('billingTitle')}</strong>
        <Check checked={value.forbidBillableCalls ?? true} disabled={!writable} onChange={v => { props.write('forbidBillableCalls', v) }}>{t('forbid')}</Check>
        <div style={muted}>{t('forbidHint')}</div>
        <Check checked={!routeEnabled(chain, 'google')} disabled={!writable} onChange={v => { props.write('chain', setRoute(chain, 'google', !v)) }}>{t('skipGemini')}</Check>
        <Check checked={value.sensitiveRequests ?? false} disabled={!writable} onChange={v => { props.write('sensitiveRequests', v) }}>{t('sensitive')}</Check>
      </div>

      <div style={card}>
        <strong>{t('chainTitle')}</strong>
        <div style={muted}>{t('chainHint')}</div>
        {chain.map((entry, index) => (
          <div key={`${entry.route}/${entry.model}`} style={row}>
            <input type="checkbox" aria-label={t('enabled')} checked={entry.enabled} disabled={!writable} onChange={() => { props.write('chain', toggle(chain, index)) }} />
            <span style={{ flex: 1, opacity: entry.enabled ? 1 : 0.5 }}>{index + 1}. <code>{entry.route}</code> / <code>{entry.model}</code></span>
            <button type="button" style={button} disabled={!writable || index === 0} aria-label={t('up')} onClick={() => { props.write('chain', move(chain, index, -1)) }}>↑</button>
            <button type="button" style={button} disabled={!writable || index === chain.length - 1} aria-label={t('down')} onClick={() => { props.write('chain', move(chain, index, 1)) }}>↓</button>
            <button type="button" style={button} disabled={!writable} aria-label={t('remove')} onClick={() => { props.write('chain', remove(chain, index)) }}>×</button>
          </div>
        ))}
        <div style={{ ...row, marginTop: 6 }}>
          <select value={pick} onChange={event => { setPick(event.target.value) }} aria-label={t('addEntry')} disabled={!writable || options.length === 0}>
            <option value="">{t('pick')}</option>
            {options.map(option => <option key={`${option.route}/${option.model}`} value={`${option.route}/${option.model}`}>{option.label}</option>)}
          </select>
          <button type="button" style={button} disabled={!writable || pick === ''} onClick={() => {
            const option = options.find(candidate => `${candidate.route}/${candidate.model}` === pick)
            if (option) props.write('chain', add(chain, option.route, option.model))
            setPick('')
          }}>{t('add')}</button>
        </div>
      </div>

      <div style={card}>
        <div style={row}>
          <label>{t('minContext')}</label>
          <input type="number" min={0} step={1000} value={value.minContext ?? 128000} disabled={!writable} style={{ width: 120 }}
            onChange={event => { const n = Number(event.target.value); if (Number.isFinite(n) && n >= 0) props.write('minContext', Math.floor(n)) }} />
        </div>
        <div style={row}>
          <label>{t('policy')}</label>
          <select value={value.switchPolicy ?? 'priority'} disabled={!writable} onChange={event => { props.write('switchPolicy', event.target.value) }}>
            <option value="priority">{t('policyPriority')}</option>
            <option value="sticky">{t('policySticky')}</option>
          </select>
        </div>
      </div>

      <h3>{t('providersTitle')}</h3>
      {report === undefined
        ? <div style={muted}>{failed ? t('noStatus') : t('loading')}</div>
        : report.providers.map(p => (
          <ProviderCard key={p.route} p={p} t={t} now={now} writable={writable} confirmed={confirmed[p.route] === true}
            onConfirm={v => { props.write('confirmedNoBilling', { ...confirmed, [p.route]: v }) }} />
        ))}
      <div style={muted}>{t('counterNote')}</div>
    </div>
  )
}
