import '@fontsource/onest/400.css'
import '@fontsource/onest/600.css'
import '@fontsource/onest/700.css'
import '@fontsource/jetbrains-mono/400.css'
import './theme.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// брошенный в окно файл не открывается вместо программы
for (const t of ['dragover', 'drop']) document.addEventListener(t, (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
