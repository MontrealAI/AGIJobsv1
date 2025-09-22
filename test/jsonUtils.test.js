const { expect } = require('chai');

const { serializeForJson } = require('../scripts/lib/json-utils');

describe('json-utils serializeForJson', () => {
  it('returns primitives unchanged', () => {
    expect(serializeForJson('value')).to.equal('value');
    expect(serializeForJson(42)).to.equal(42);
    expect(serializeForJson(false)).to.equal(false);
  });

  it('serializes bigint-like values to strings', () => {
    expect(serializeForJson(12n)).to.equal('12');

    const { BN } = web3.utils;
    expect(serializeForJson(new BN('9876543210'))).to.equal('9876543210');
  });

  it('serializes nested structures', () => {
    const { BN } = web3.utils;
    const input = {
      array: [new BN('1'), 2n, true],
      object: {
        nested: new BN('3'),
      },
    };

    expect(serializeForJson(input)).to.deep.equal({
      array: ['1', '2', true],
      object: { nested: '3' },
    });
  });
});
