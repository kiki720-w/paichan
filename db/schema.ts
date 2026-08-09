import {integer,sqliteTable,text} from 'drizzle-orm/sqlite-core';
export const appState=sqliteTable('app_state',{id:integer('id').primaryKey(),data:text('data').notNull(),updatedAt:text('updated_at').notNull()});
export const factoryState=sqliteTable('factory_state',{factory:text('factory').primaryKey(),data:text('data').notNull(),updatedAt:text('updated_at').notNull()});
