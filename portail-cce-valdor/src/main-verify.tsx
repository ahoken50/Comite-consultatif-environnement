
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './store/store';
import ProjectsPage from './pages/Projects/ProjectsPage';
import { ThemeProvider, createTheme } from '@mui/material/styles';

const theme = createTheme();

// Bypass Auth and Routing to render ProjectsPage directly
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <BrowserRouter>
          <ProjectsPage />
        </BrowserRouter>
      </ThemeProvider>
    </Provider>
  </React.StrictMode>
);
