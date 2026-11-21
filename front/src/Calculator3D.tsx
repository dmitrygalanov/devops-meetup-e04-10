import { useEffect, useReducer, useRef, useState } from 'react'
import {
  type CalcState,
  type Key,
  OP_SYMBOLS,
  formatNumber,
  initialState,
  keyFromKeyboard,
  press,
} from './calculator'
import { BUTTONS, CalculatorScene, type DisplayContent } from './CalculatorScene'

function displayContent(state: CalcState): DisplayContent {
  return {
    main: state.display,
    sub:
      state.prev !== null && state.op !== null
        ? `${formatNumber(state.prev)} ${OP_SYMBOLS[state.op]}`
        : '',
    activeOp: state.op !== null && state.overwrite ? state.op : null,
  }
}

function createScene(
  canvas: HTMLCanvasElement,
  onKey: (key: Key) => void,
  onError: (message: string) => void,
): CalculatorScene | null {
  try {
    return new CalculatorScene(canvas, onKey)
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err))
    return null
  }
}

function Calculator3D() {
  const [state, dispatch] = useReducer(press, initialState)
  const [webglError, setWebglError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<CalculatorScene | null>(null)
  const content = displayContent(state)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = createScene(canvas, (key) => dispatch(key), setWebglError)
    if (!scene) return
    sceneRef.current = scene
    const onLost = (e: Event) => {
      e.preventDefault()
      scene.dispose()
      sceneRef.current = null
      setWebglError('WebGL context lost')
    }
    canvas.addEventListener('webglcontextlost', onLost)
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setDisplay(displayContent(state))
  }, [state])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      // Let Enter/Space activate a focused DOM button normally
      if (target?.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return
      const key = keyFromKeyboard(e.key)
      if (!key) return
      e.preventDefault()
      dispatch(key)
      sceneRef.current?.flash(key)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="calc">
      {webglError === null ? (
        <canvas
          ref={canvasRef}
          className="calc-canvas"
          role="img"
          aria-label="Interactive 3D calculator. Use the keyboard to enter numbers and operators."
        />
      ) : (
        <div className="calc-fallback" role="group" aria-label="Calculator">
          <div className="calc-fallback-display">
            <span className="calc-fallback-sub">{content.sub}</span>
            <span className="calc-fallback-main">{content.main}</span>
          </div>
          <div className="calc-fallback-keys">
            {BUTTONS.map((b) => (
              <button
                key={b.key}
                type="button"
                className={`calc-key calc-key-${b.kind}${content.activeOp === b.key ? ' is-active' : ''}`}
                style={{ gridColumn: `span ${b.span}` }}
                onClick={() => dispatch(b.key)}
              >
                {b.label}
              </button>
            ))}
          </div>
          <p className="calc-note">3D view unavailable ({webglError}).</p>
        </div>
      )}
      <output className="sr-only" aria-live="polite">
        {content.main}
      </output>
    </div>
  )
}

export default Calculator3D
