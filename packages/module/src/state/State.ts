/* eslint-disable max-classes-per-file */
/* eslint-disable new-cap */
/* eslint-disable @typescript-eslint/prefer-readonly-parameter-types */
/* eslint-disable import/prefer-default-export */
/* eslint-disable import/no-unused-modules */
import {
  Bool,
  Circuit,
  Field,
  FlexibleProvable,
  FlexibleProvablePure,
} from 'snarkyjs';

import { Option } from '../option/Option.js';
import { ProvableStateTransition } from '../stateTransition/StateTransition.js';
import { Path } from '../path/Path.js';

export class WithPath {
  public path?: Field;

  public hasPathOrFail(): asserts this is { path: Path } {
    if (!this.path) {
      throw new Error(
        `Could not find 'path', did you forget to add '@state' to your state property?`
      );
    }
  }
}

export class State<Value> extends WithPath {
  public static from<Value>(valueType: FlexibleProvablePure<Value>) {
    return new State<Value>(valueType);
  }

  public static dummyValue<Value>(
    valueType: FlexibleProvablePure<Value>
  ): Value {
    const length = valueType.sizeInFields();
    const fields = Array.from({ length }, () => Field(0));

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return valueType.fromFields(fields) as Value;
  }

  public constructor(public valueType: FlexibleProvablePure<Value>) {
    super();
  }

  private witnessState() {
    // get the value from storage, or return a dummy value instead
    const value = Circuit.witness(this.valueType, () =>
      State.dummyValue<Value>(this.valueType)
    );

    // check if the value exists in the storage or not
    const isSome = Circuit.witness(Bool, () => Bool(true));

    return Option.from(isSome, value, this.valueType);
  }

  public get(): [Option<Value>, ProvableStateTransition] {
    const option = this.witnessState();
    const provableOption = option.toProvable();

    this.hasPathOrFail();

    const stateTransition = ProvableStateTransition.from(
      this.path,
      provableOption
    );

    return [option, stateTransition];
  }

  public set(value: Value): ProvableStateTransition {
    // link the transition to the current state
    const provableFromOption = this.witnessState().toProvable();
    const provableToOption = Option.from(
      Bool(true),
      value,
      this.valueType
    ).toProvable();

    this.hasPathOrFail();

    return ProvableStateTransition.fromTo(
      this.path,
      provableFromOption,
      provableToOption
    );
  }
}
