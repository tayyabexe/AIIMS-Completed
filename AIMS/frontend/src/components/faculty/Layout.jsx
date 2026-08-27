import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import '../../styles/faculty.css';

export default function Layout({ title, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main-area">
        <Header title={title} onMenuClick={() => setSidebarOpen((v) => !v)} />
        {/*
          * `aims-dash` declares the `--ad-*` design tokens (index.css) and
          * nothing else — no background, no font, no colour of its own. It is
          * here because the pinned-board components this portal shares with
          * the admin one (CardGrid, EditPanel, SavedQueryCard and the whole of
          * pinned.css) are written against those tokens, and outside a
          * `.aims-dash` ancestor every one of them resolves to nothing: the
          * Customise chip loses its border and background, cards lose their
          * surface, and the board renders as unstyled text on the page ground.
          *
          * It sits on the shell rather than on the two boards so the tokens are
          * also in scope for the parts that escape their subtree — the
          * `position: fixed` palette, the right-click card menu, and the Save
          * dialog the Ask the Data canvas opens.
          */}
        <main className="page-content aims-dash">{children}</main>
      </div>
    </div>
  );
}
