"""Download the PokeAPI CSV exports that build_data.py reads into tools/csv/."""
import os, urllib.request
BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/'
FILES = ['versions', 'version_names', 'version_groups', 'pokedex_version_groups', 'pokedexes', 'pokedex_prose',
         'pokemon_dex_numbers', 'pokemon', 'pokemon_species', 'pokemon_species_names', 'pokemon_types',
         'pokemon_types_past', 'types', 'type_names', 'pokemon_stats', 'pokemon_moves', 'pokemon_move_methods',
         'moves', 'move_names', 'move_changelog', 'move_damage_classes', 'encounters', 'encounter_slots',
         'encounter_methods', 'encounter_method_prose', 'encounter_conditions', 'encounter_condition_value_map',
         'encounter_condition_value_prose', 'location_areas', 'location_area_prose', 'locations', 'location_names',
         'generations', 'pokemon_forms', 'machines']
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'csv')
os.makedirs(out, exist_ok=True)
for f in FILES:
    urllib.request.urlretrieve(BASE + f + '.csv', os.path.join(out, f + '.csv'))
    print('ok', f)
