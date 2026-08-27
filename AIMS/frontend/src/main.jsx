import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/faculty.css'
// The shared loading language (skeleton placeholders + the dialog keyframes
// several common components animate with). Global because every portal route
// uses it and no single page owns it.
import './styles/skeletons.css'
// Last, deliberately. It corrects sizing declared by both files above, and CSS
// ties are broken by source order.
import './styles/viewport.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
