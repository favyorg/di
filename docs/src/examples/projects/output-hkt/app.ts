import { Score } from './score';

const box = Score({ base: 41 });
// The HKT keeps the name, required base, and the number inside the box.
console.log(`${Score.name}: ${box.value.toFixed(0)}`); // Score: 42
