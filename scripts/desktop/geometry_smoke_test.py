import copy
import unittest
from geometry_smoke import assert_initial, assert_restored, geometry_scenario
from ordinary_smoke import composition_plan


class GeometryTests(unittest.TestCase):
    def value(self):
        return {
            'frame': {'origin': {'x': -1800, 'y': 30}, 'size': {'width': 1280, 'height': 850}},
            'workArea': {'origin': {'x': -1920, 'y': 30}, 'size': {'width': 1920, 'height': 850}},
        }

    def test_initial_outer_work_area_and_negative_origin(self):
        value = self.value()
        assert_initial(value)
        for group, key, bad in (
            ('origin', 'y', 0),
            ('origin', 'x', -2000),
            ('size', 'height', 900),
            ('size', 'width', 2000),
        ):
            changed = copy.deepcopy(value)
            changed['frame'][group][key] = bad
            with self.assertRaises(ValueError):
                assert_initial(changed)

    def test_restore_compares_position_and_size_with_native_rounding(self):
        value = self.value()
        assert_restored(value, value)
        for group, keys in (('origin', ('x', 'y')), ('size', ('width', 'height'))):
            for key in keys:
                changed = copy.deepcopy(value)
                changed['frame'][group][key] += 3
                with self.assertRaises(ValueError):
                    assert_restored(value, changed)

    def test_shared_native_scenario_requires_full_owned_regression(self):
        with self.assertRaises(ValueError):
            composition_plan((geometry_scenario(),), 'shared', 'native geometry', False)
        _, plan = composition_plan((geometry_scenario(),), 'shared', 'native geometry', True)
        self.assertEqual(plan['instances'], 2)
        self.assertIn('window-geometry', plan['selected'])
