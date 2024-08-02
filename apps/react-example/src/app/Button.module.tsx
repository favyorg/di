import { Module } from '@favy/di';

type ButtonProps = {
  text: string;
  onClick(): void;
};

export const Button = Module()('Button', () => {
  return (props: ButtonProps) => {
    return <button onClick={props.onClick}>{props.text}</button>;
  };
});

export type ButtonLive = typeof Button.Live;
