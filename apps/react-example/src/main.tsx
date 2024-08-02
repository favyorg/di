import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';

import { App } from './app/app';
import { Api } from './app/Api.module';
import { Posts } from './app/Posts.module';
import { Request } from './app/Request.module';
// import { Button } from './app/Button.module';

const Root = App({
  BASE_URL: 'https://jsonplaceholder.typicode.com',
  Posts,
  Api,
  Request,
  // override default
  Button: (props) => (
    <button color="green" onClick={props.onClick}>
      {props.text}
    </button>
  ),
  fetch,
});

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <StrictMode>
    <Root />
  </StrictMode>
);
