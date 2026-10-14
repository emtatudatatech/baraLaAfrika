import './styles/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { router } from './app/router';
import { ThemeProvider } from './app/theme/ThemeProvider';

const container = document.getElementById('root');
if (container === null) throw new Error('#root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);
