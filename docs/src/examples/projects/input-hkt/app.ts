import { Sum } from './sum';

// Callers still pass the original dependency map, without a wrapped field.
console.log(Sum({ left: 20, right: 22 })); // 42
