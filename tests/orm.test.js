import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractORMFromCode, extractSQLFromCode } from '../src/lang-sql.js';

describe('ORM Detection', () => {
  describe('Prisma', () => {
    it('detects prisma read methods', () => {
      const code = `
        const users = await prisma.user.findMany({ where: { active: true } });
        const order = await prisma.order.findFirst({ where: { id: 1 } });
        const count = await prisma.product.count();
      `;
      const result = extractORMFromCode(code);
      assert.deepStrictEqual(result.reads.sort(), ['order', 'product', 'user']);
      assert.deepStrictEqual(result.writes, []);
    });

    it('detects prisma write methods', () => {
      const code = `
        await prisma.user.create({ data: { name: 'test' } });
        await prisma.order.update({ where: { id: 1 }, data: { status: 'done' } });
        await prisma.session.delete({ where: { id: 1 } });
      `;
      const result = extractORMFromCode(code);
      assert.deepStrictEqual(result.reads, []);
      assert.deepStrictEqual(result.writes.sort(), ['order', 'session', 'user']);
    });

    it('skips prisma internal methods', () => {
      const code = `await prisma.$connect(); prisma.$transaction([]);`;
      const result = extractORMFromCode(code);
      assert.deepStrictEqual(result.reads, []);
      assert.deepStrictEqual(result.writes, []);
    });
  });

  describe('Sequelize', () => {
    it('detects Sequelize read methods', () => {
      const code = `
        const users = await User.findAll({ where: { active: true } });
        const order = await Order.findOne({ where: { id: 1 } });
        const count = await Product.count();
      `;
      const result = extractORMFromCode(code);
      assert.deepStrictEqual(result.reads.sort(), ['order', 'product', 'user']);
    });

    it('detects Sequelize write methods', () => {
      const code = `
        await User.create({ name: 'test' });
        await Order.destroy({ where: { id: 1 } });
        await Product.bulkCreate([{ name: 'a' }]);
      `;
      const result = extractORMFromCode(code);
      assert.deepStrictEqual(result.writes.sort(), ['order', 'product', 'user']);
    });

    it('skips built-in JS classes', () => {
      const code = `
        const p = Promise.resolve();
        JSON.parse('{}');
        Object.create(null);
        Array.from([]);
      `;
      const result = extractORMFromCode(code);
      assert.deepStrictEqual(result.reads, []);
      assert.deepStrictEqual(result.writes, []);
    });
  });

  describe('Knex', () => {
    it('detects knex table reads', () => {
      const code = `const users = await knex('users').where('active', true).select('*');`;
      const result = extractORMFromCode(code);
      assert.ok(result.reads.includes('users'));
    });

    it('detects knex table writes', () => {
      const code = `await knex('orders').insert({ product: 'test' });`;
      const result = extractORMFromCode(code);
      assert.ok(result.writes.includes('orders'));
    });

    it('detects .from() and .into()', () => {
      const code = `
        knex.select('*').from('products');
        knex.insert({ name: 'test' }).into('orders');
      `;
      const result = extractORMFromCode(code);
      assert.ok(result.reads.includes('products'));
      assert.ok(result.writes.includes('orders'));
    });
  });

  describe('Integration with extractSQLFromCode', () => {
    it('ORM results merge with raw SQL results', () => {
      const code = `
        const raw = db.query("SELECT * FROM accounts WHERE active = true");
        const users = await prisma.user.findMany();
        await knex('orders').insert({ item: 'x' });
      `;
      const result = extractSQLFromCode(code);
      assert.ok(result.reads.includes('accounts'), 'raw SQL read');
      assert.ok(result.reads.includes('user'), 'prisma read');
      assert.ok(result.writes.includes('orders'), 'knex write');
    });
  });
});
