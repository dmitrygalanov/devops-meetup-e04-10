import Calculator3D from './Calculator3D'
import ThemeToggle from './ThemeToggle'
import './App.css'

function App() {
  return (
    <>
      <ThemeToggle />
      <main className="page">
        <h1>Calculator</h1>
        <p className="tagline">
          A real-time 3D calculator rendered with WebGL. Click the keys, drag
          the body to spin it, or just type.
        </p>
        <Calculator3D />
        <p className="hint">
          Keyboard: <kbd>0–9</kbd> <kbd>.</kbd> <kbd>+</kbd> <kbd>-</kbd>{' '}
          <kbd>*</kbd> <kbd>/</kbd> <kbd>%</kbd> <kbd>Enter</kbd>{' '}
          <kbd>Backspace</kbd> <kbd>Esc</kbd>
        </p>
      </main>
    </>
  )
}

export default App
