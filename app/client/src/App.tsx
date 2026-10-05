import { HashRouter, Route, Routes } from 'react-router';
import { Shell } from './components/Shell.tsx';
import { About } from './pages/About.tsx';
import { Chat } from './pages/Chat.tsx';
import { Ops } from './pages/Ops.tsx';
import { Sources } from './pages/Sources.tsx';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Chat />} />
          <Route path="sources" element={<Sources />} />
          <Route path="ops" element={<Ops />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<Chat />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
