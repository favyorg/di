# Зачем это нужно?
## Что не так с `InversifyJS` и `TSyringe?`
### 1. Декораторы не типобезопасны
Можно просто забыть написать `@injectable` у класса и получить `runtime error`.
### 2. Контейнер никак не связан типами зависимостей и их именами
Это значит что если мы не передадим какую то зависимость в контейнер то при получении зависимости у нас будет ошибка в `runtime`.<br />
В `@favy/di` ошибка будет видна сразу же прямо в редакторе кода.<br />
Можно передать неверные типы и имена в контейнер `container.resolveAll<Bar>("Bar")` при этом контейнер не знает какие типы и ошибку можно увидеть если повезет только в рантайме.
Если тип будет не верен но будет частично совпадать то может быть так что ошибка проявится только во время работы программы.
### 3. Слишком много кода
Для внедрения зависимостей нам приходилось создавать и описывать контейнер, обвешивать классы и поля в конструкторе декораторами.
### 4. Только для классов
Мы можем использовать только классы для внедрения зависимостей, в `@favy/di` можно использовать любое значение.
### 5. Сложность понимания
Новичкам сложно разобраться с концепцией IoC контейнеров, не всегда старший разработчик в силах быстро объяснить зачем это нужно и как правильно это использовать.

## Что предлагает @favy/di?
### Модуль это просто функция
```ts
import {Module} from "@favy/di";

type AppArgs = {name: string};
const App = ({name}: AppArgs) => { console.log(name) }
App({name: "Alex"}) // Alex
/* Что бы сделать функцию модулем, просто пишем Module и все! */
const App = Module("App", ({name}: AppArgs) => { console.log(name) });
App({name: "Alex"}) // Alex
```
Но зачем если можно просто написать функцию?<br />
Когда у нас будет большая цепочка вызова функций то нам придется прокидывать в аргументы данные и описывать несколько раз типы необходимые в самом низу. <br />
@favy/di сам выводит тип требуемых зависимостей в подмодулях, вам не придется вручную указывать их повторно в более верхнем уровне модулей, зависимости автоматически прокидываются на нужный уровень, туда где они требуются.
Что бы было понятнее давайте посмотрим на пример с двумя модулями:
```ts
import {Service} from "@favy/di";

const Logger = Service('Logger', ({ prefix }: { prefix: string }) => ({
  log(message: string) {
    console.log(`[${prefix} ${new Date().toISOString()}] ${message}`);
  }
}));
type LoggerLive = Live<typeof Logger>;

const App = Module('App', ({ Logger }: LoggerLive) => {
  Logger.log("starting...");
});
App({ Logger, prefix: 'myService' }) // [myService 2022-07-21T08:04:10.658Z] starting...
```
Мы можем заменить любой модуль на другой с подходящим типом<br/>
Например Logger мы можем при необходимости заменить на JSONLogger или MOCKLogger.<br/>
Вот так просто мы уже можем написать простой и тестируемый код.<br/>
Давайте подробнее рассмотрим что происходит.
```ts
import {Service} from "@favy/di";
// Service как модуль но будет вызван только один раз
const Logger = Service('Logger', ({ prefix }: { prefix: string }) => ({
  // Мы просим при вызове предоставить prefix типа string
  // Мы можем вернуть из функции абсолютно любое значение
  log(message: string) {
    console.log(`[${prefix} ${new Date().toISOString()}] ${message}`);
  }
}));
// Этот тип вычислят значение вызванной функции и добавляет его в объект с ключом Logger
// { Logger: typeof Logger } добавляя к типу информацию о зависимостях
type LoggerLive = Live<typeof Logger>;

// Мы запрашиваем в зависимостях модуль Logger,
// Если у нас будет два модуля мы просто напишем LoggerLive & RouterLive
const App = Module('App', ({ Logger }: LoggerLive) => {
  // Теперь мы можем просто вызывать модуль, свои зависимости он уже получил при создании
  Logger.log("starting...");
});

// Запускаем все приложением целиком, создаются всем модули и предаются зависимости
// Мы можем подменить Logger на любой другой модуль подходящий по типу
App({ Logger, prefix: 'myService' }) // [myService 2022-07-21T08:04:10.658Z] starting...
// ------------ А что если нам нужно возвращать логи в JSON?
// Просто опишем другой сервис
const JSONLogger = Module('JSONLogger', ({ prefix }: { prefix: string }) => ({
  log(message: string) {
    console.log(JSON.stringify({ prefix, dateTime: Date.now(), message }));
  }
}));

// Мы можем так подменить любой модуль на любом уровне
App({ Logger: JSONLogger, prefix: 'myService' })
// {"prefix":"myService","dateTime":1658390747811,"message":"starting..."}
```