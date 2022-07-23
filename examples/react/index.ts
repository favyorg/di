// import { Module, Live } from '../../src/index';

// const Logger = Module('Logger', ({ prefix }: { prefix: string }) => ({
//   log(message: string) {
//     console.log(`[${prefix} ${new Date().toISOString()}] ${message}`);
//   }
// }));
// type LoggerLive = Live<typeof Logger>;

// const App = Module('App', ({ Logger }: LoggerLive) => {
//   Logger.log("starting...");
//   // ...
// });
