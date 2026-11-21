// Pure calculator state machine (no DOM / WebGL dependencies).

export type Op = '+' | '-' | '*' | '/'

export type Key =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '.' | '+' | '-' | '*' | '/' | '=' | 'AC' | 'neg' | '%' | 'back'

export interface CalcState {
  display: string
  prev: number | null
  op: Op | null
  // Next digit starts a new number instead of appending
  overwrite: boolean
  error: boolean
}

const MAX_DIGITS = 12

export const initialState: CalcState = {
  display: '0',
  prev: null,
  op: null,
  overwrite: true,
  error: false,
}

export const OP_SYMBOLS: Record<Op, string> = {
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return 'Error'
  if (Object.is(n, -0)) n = 0
  const abs = Math.abs(n)
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) {
    // 1.234560e+15 -> 1.23456e+15
    return n.toExponential(6).replace(/\.?0+e/, 'e')
  }
  return String(parseFloat(n.toPrecision(MAX_DIGITS)))
}

function compute(a: number, op: Op, b: number): number {
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': return a / b
  }
}

function withResult(state: CalcState, value: number): CalcState {
  const display = formatNumber(value)
  return display === 'Error'
    ? { ...initialState, display, error: true }
    : { ...state, display }
}

function digitCount(s: string): number {
  return s.replace(/[^0-9]/g, '').length
}

export function press(state: CalcState, key: Key): CalcState {
  if (state.error && key !== 'AC') {
    // Any input after an error starts fresh
    state = initialState
    if (!/^[0-9.]$/.test(key)) return state
  }

  const current = parseFloat(state.display)

  switch (key) {
    case 'AC':
      return initialState

    case '.':
      if (state.overwrite) return { ...state, display: '0.', overwrite: false }
      if (state.display.includes('.')) return state
      return { ...state, display: state.display + '.' }

    case 'neg':
      if (state.display === '0') return state
      return {
        ...state,
        display: state.display.startsWith('-')
          ? state.display.slice(1)
          : '-' + state.display,
      }

    case '%':
      return { ...withResult(state, current / 100), overwrite: true }

    case 'back': {
      if (state.overwrite) return state
      const next = state.display.slice(0, -1)
      return {
        ...state,
        display: next === '' || next === '-' ? '0' : next,
        overwrite: next === '' || next === '-',
      }
    }

    case '=': {
      if (state.op === null || state.prev === null) {
        return { ...state, overwrite: true }
      }
      const result = withResult(state, compute(state.prev, state.op, current))
      return result.error
        ? result
        : { ...result, prev: null, op: null, overwrite: true }
    }

    case '+':
    case '-':
    case '*':
    case '/': {
      if (state.op !== null && state.prev !== null && !state.overwrite) {
        // Chain: 2 + 3 + -> shows 5
        const result = withResult(state, compute(state.prev, state.op, current))
        if (result.error) return result
        return {
          ...result,
          prev: parseFloat(result.display),
          op: key,
          overwrite: true,
        }
      }
      return { ...state, prev: current, op: key, overwrite: true }
    }

    default: {
      // Digit
      if (state.overwrite) return { ...state, display: key, overwrite: false }
      if (state.display === '0') return { ...state, display: key }
      if (state.display === '-0') return { ...state, display: '-' + key }
      if (digitCount(state.display) >= MAX_DIGITS) return state
      return { ...state, display: state.display + key }
    }
  }
}

// Map a KeyboardEvent.key to a calculator key
export function keyFromKeyboard(k: string): Key | null {
  if (/^[0-9]$/.test(k)) return k as Key
  switch (k) {
    case '.':
    case ',':
      return '.'
    case '+':
    case '-':
    case '*':
    case '/':
    case '%':
      return k
    case 'x':
    case 'X':
      return '*'
    case '=':
    case 'Enter':
      return '='
    case 'Escape':
    case 'Delete':
    case 'c':
    case 'C':
      return 'AC'
    case 'Backspace':
      return 'back'
    case 'F9':
      return 'neg'
    default:
      return null
  }
}
