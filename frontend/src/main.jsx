import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Prevent scroll from changing focused number input values
document.addEventListener('wheel', () => {
  if (document.activeElement?.type === 'number') {
    document.activeElement.blur()
  }
}, { passive: true })

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
