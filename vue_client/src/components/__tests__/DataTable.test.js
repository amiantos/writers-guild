import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DataTable from '../DataTable.vue';

describe('DataTable', () => {
  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'actions', label: 'Actions', sortable: false, noRowClick: true },
  ];

  const data = [{ id: '1', name: 'First' }];

  function mountTable(props = {}) {
    return mount(DataTable, {
      props: { columns, data, ...props },
    });
  }

  describe('Row click', () => {
    it('should not emit row-click when rowClickable is not set', async () => {
      const wrapper = mountTable();

      await wrapper.find('td').trigger('click');

      expect(wrapper.emitted('row-click')).toBeUndefined();
    });

    it('should emit row-click with the row when a normal cell is clicked', async () => {
      const wrapper = mountTable({ rowClickable: true });

      await wrapper.find('td').trigger('click');

      expect(wrapper.emitted('row-click')).toHaveLength(1);
      expect(wrapper.emitted('row-click')[0]).toEqual([data[0]]);
    });

    it('should not emit row-click for a column marked noRowClick', async () => {
      const wrapper = mountTable({ rowClickable: true });

      await wrapper.findAll('td')[1].trigger('click');

      expect(wrapper.emitted('row-click')).toBeUndefined();
    });
  });
});
