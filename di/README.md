# @favy/di
Fast, Easy, Powerful and Simple Dependency Injection

## Возможности
Низкий уровень сложности.
Внедрение зависимостей без боли.
Легкая интеграция с любым кодом.
Высокая расширяемость.

## Это правда так просто?
```ts
import { Module } from 'di';

const A = Module()('A', () => 'A');
type ALive = Live<A>;

const B = Module()('B', () => 'B');
type BLive = Live<B>;

const App = Module<ALive & BLive>()('App', ({ A, B }) => {
  return A + B;
});

App({ A, B }); // AB 

App({ A: () => 'C', B }); // CB
```

