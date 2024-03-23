import "reflect-metadata";
import {
  Runtime,
  RuntimeModule,
  RuntimeModulesRecord,
  runtimeMethod,
  runtimeModule,
  state,
} from "@proto-kit/module";
import {
  ProtocolModulesRecord,
  StateMap,
  VanillaProtocol,
} from "@proto-kit/protocol";
import {
  AppChain,
  AppChainModulesRecord,
  BlockStorageNetworkStateModule,
  InMemorySigner,
  InMemoryTransactionSender,
  StateServiceQueryModule,
} from "@proto-kit/sdk";
import {
  BlockProducerModule,
  InMemoryDatabase,
  LocalTaskQueue,
  LocalTaskWorkerModule,
  ManualBlockTrigger,
  NoopBaseLayer,
  PrivateMempool,
  Sequencer,
  SequencerModulesRecord,
  SettlementModule,
  UnprovenProducerModule,
} from "@proto-kit/sequencer";
import { log } from "@proto-kit/common";
import { PrivateKey, PublicKey, UInt64 } from "o1js";

import { PrismaRedisDatabase } from "../src/PrismaRedisDatabase";

log.setLevel("DEBUG");

class TestingAppChain<
  RuntimeModules extends RuntimeModulesRecord,
  SequencerModules extends SequencerModulesRecord
> extends AppChain<
  RuntimeModules,
  ProtocolModulesRecord,
  SequencerModules,
  AppChainModulesRecord
> {
  public static fromRuntime<
    RuntimeModules extends RuntimeModulesRecord
  >(definition: { modules: RuntimeModules }) {
    const runtime = Runtime.from({
      ...definition,
    });

    const sequencer = Sequencer.from({
      modules: {
        // Database: InMemoryDatabase,
        Database: PrismaRedisDatabase,
        Mempool: PrivateMempool,
        LocalTaskWorkerModule,
        BaseLayer: NoopBaseLayer,
        BlockProducerModule,
        UnprovenProducerModule,
        BlockTrigger: ManualBlockTrigger,
        TaskQueue: LocalTaskQueue,
        SettlementModule: SettlementModule,
      },
    });

    const appChain = new TestingAppChain({
      runtime,
      protocol: VanillaProtocol.from({}),
      sequencer,

      modules: {
        Signer: InMemorySigner,
        TransactionSender: InMemoryTransactionSender,
        QueryTransportModule: StateServiceQueryModule,
        NetworkStateTransportModule: BlockStorageNetworkStateModule,
      },
    });

    appChain.configurePartial({
      Sequencer: {
        // Database: {},
        Database: {
          redis: {
            url: "redis://localhost:6379",
            password: "password",
          },
          prisma: {
            connection: {
              host: "localhost",
              password: "password",
              username: "admin",
              port: 5432,
              db: {
                name: "protokit",
              },
            },
          },
        },
        BlockTrigger: {},
        Mempool: {},
        BlockProducerModule: {},
        LocalTaskWorkerModule: {},
        BaseLayer: {},
        UnprovenProducerModule: {},

        TaskQueue: {
          simulatedDuration: 0,
        },
        SettlementModule: {
          feepayer: PrivateKey.random(),
          address: PrivateKey.random().toPublicKey(),
        },
      },

      Protocol: {
        AccountState: {},
        BlockProver: {},
        StateTransitionProver: {},
        BlockHeight: {},
        LastStateRoot: {},
      },

      Signer: {},
      TransactionSender: {},
      QueryTransportModule: {},
      NetworkStateTransportModule: {},
    });

    return appChain;
  }

  public setSigner(signer: PrivateKey) {
    const inMemorySigner = this.resolveOrFail("Signer", InMemorySigner);
    inMemorySigner.config.signer = signer;
  }

  public async produceBlock() {
    const blockTrigger = this.sequencer.resolveOrFail(
      "BlockTrigger",
      ManualBlockTrigger
    );

    return await blockTrigger.produceUnproven();
  }
}

@runtimeModule()
class TestModule extends RuntimeModule<{}> {
  @state() map = StateMap.from(PublicKey, UInt64);

  @runtimeMethod()
  public increment() {
    const address = this.transaction.sender.value;
    const value = this.map.get(address);
    this.map.set(address, value.value.add(UInt64.from(1)));
  }
}

interface RuntimeModules extends RuntimeModulesRecord {
  TestModule: typeof TestModule;
}

describe("persistance", () => {
  const aliceKey = PrivateKey.random();
  const alice = aliceKey.toPublicKey();

  let chain: TestingAppChain<RuntimeModules, any>;

  let module: TestModule;

  beforeAll(async () => {
    chain = TestingAppChain.fromRuntime({
      modules: {
        TestModule,
      },
    });

    chain.configurePartial({
      Runtime: {
        TestModule: {},
      },
    });

    await chain.start();

    module = chain.runtime.resolve("TestModule");
  }, 30_000);

  it("should handle state change; account #1", async () => {
    chain.setSigner(aliceKey);
    const tx = await chain.transaction(alice, () => {
      module.increment();
    });
    await tx.sign();
    await tx.send();

    const block = await chain.produceBlock();
    const val = await chain.query.runtime.TestModule.map.get(alice);

    expect(block?.transactions[0].status.toBoolean()).toBe(true);
    expect(val?.toBigInt()).toBe(1n);
  });

  it("should handle state change; account #2", async () => {
    const bobKey = PrivateKey.random();
    const bob = bobKey.toPublicKey();

    chain.setSigner(bobKey);

    const tx = await chain.transaction(bob, () => {
      module.increment();
    });
    await tx.sign();
    await tx.send();

    const block = await chain.produceBlock();
    const val = await chain.query.runtime.TestModule.map.get(bob);

    expect(block?.transactions[0].status.toBoolean()).toBe(true);
    expect(val?.toBigInt()).toBe(1n);
  });

  it("should handle another state change; account #1", async () => {
    chain.setSigner(aliceKey);
    const tx = await chain.transaction(alice, () => {
      module.increment();
    });
    await tx.sign();
    await tx.send();

    const block = await chain.produceBlock();
    const val = await chain.query.runtime.TestModule.map.get(alice);

    expect(block?.transactions[0].status.toBoolean()).toBe(true);
    expect(val?.toBigInt()).toBe(2n);
  });
});
