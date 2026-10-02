import { Counter } from './counter';

const counter = Counter({ step: 1 });
const button = document.querySelector<HTMLButtonElement>('#increment')!;
const output = document.querySelector<HTMLOutputElement>('#count')!;

button.onclick = () => {
  output.textContent = String(counter.Increment());
};
