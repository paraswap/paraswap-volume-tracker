source .env

# Set the base URL
# epoch 020 - 51 = 4129987 # CSV=true bash fetch-from-dune.sh > 020-51-sorted.csv
# epoch 021 - 52 = 4132184 # CSV=true bash fetch-from-dune.sh > 021-52-sorted.csv
# epoch 022 - 53 = 4221949 # CSV=true bash fetch-from-dune.sh > 022-53-sorted.csv
BASE_URL="https://api.dune.com/api/v1/query/4221949/results"

# Check if CSV is set to true and modify the URL if necessary
if [ "$CSV" = "true" ]; then
  BASE_URL="${BASE_URL}/csv"
  curl --request GET \
    --url "$BASE_URL" \
    -H 'content-type: application/json' \
    -H "X-Dune-Api-Key: $DUNE_API_KEY"
else
  curl --request GET \
    --url "$BASE_URL" \
    -H 'content-type: application/json' \
    -H "X-Dune-Api-Key: $DUNE_API_KEY" 
fi